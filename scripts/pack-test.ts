/**
 * Packs every published package and consumes it the way a user would.
 *
 * `npm run build` only proves the bundles compile. It says nothing about whether the
 * published artifacts are usable: whether `exports` resolve, whether `files` ships exactly
 * what the entry points need, whether each package declares its own dependencies (every
 * package is installed into its own empty project, so one package cannot hide another's
 * missing dependency), whether the public `.d.ts` files typecheck without dev-only
 * packages, and whether png-renderer explains a missing native binary. The MapLibre
 * plugin's UMD bundle and the GitHub release tarball are checked too.
 *
 * Options:
 *   --docker      also install and run png-renderer in Linux containers: node:22-slim
 *                 (glibc, the oldest supported Node) and node:24-alpine (musl)
 *   --out <dir>   keep the tested package tarballs in <dir>; the release workflow
 *                 publishes exactly these files
 *
 * `npm pack` runs with `--ignore-scripts`; the tarballs are packed from whatever each
 * package's `dist/` currently holds, so run `npm run build` first.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const repo = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const withDocker = args.includes('--docker');
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (outIndex >= 0 && !outDir) {
	console.error('--out needs a directory');
	process.exit(2);
}

const useColor = !process.env.NO_COLOR;
const paint = (code: number, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s: string): string => paint(31, s);
const green = (s: string): string => paint(32, s);
const dim = (s: string): string => paint(90, s);

let failures = 0;
function check(name: string, run: () => string): void {
	try {
		const detail = run();
		console.log(`  ${green('✓')} ${name}${detail ? dim(` — ${detail}`) : ''}`);
	} catch (error) {
		failures++;
		// A failed child process keeps the interesting part (tsc's diagnostics) in stdout,
		// not in the message.
		const output = ((error as { stdout?: string }).stdout ?? '').trim();
		const message = String(error instanceof Error ? error.message : error).split('\n')[0] ?? '';
		console.log(`  ${red('✗')} ${name}`);
		for (const line of (output || message).split('\n').slice(0, 8)) {
			console.log(red(`      ${line}`));
		}
	}
}

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** Runs an ES module snippet (top-level await allowed) in a consumer project. */
function runModule(code: string, cwd: string): string {
	return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

/** Runs a CommonJS snippet in a consumer project. */
function runCommonJS(code: string, cwd: string): string {
	return execFileSync(process.execPath, ['--input-type=commonjs', '-e', code], {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

const MINIMAL_STYLE = '{ version: 8, sources: {}, layers: [] }';
const BACKGROUND_STYLE =
	"{ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0000ff' } }] }";

/** Checks the bytes of a PNG: signature and IHDR size. Used inside consumer snippets. */
const ASSERT_PNG = `
	const assertPng = (png, w, h) => {
		const signature = [...png.subarray(0, 4)].join(',');
		if (signature !== '137,80,78,71') throw new Error('not a PNG: ' + signature);
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		if (view.getUint32(16) !== w || view.getUint32(20) !== h) throw new Error('wrong size');
		return png.length + ' bytes, ' + w + 'x' + h;
	};`;

interface PackageSpec {
	dir: string;
	/** Exactly the files the tarball must contain. */
	files: string[];
	/** The published `.d.ts` entry. */
	types: string;
	/** Modules the published types may import besides `geojson`: declared dependencies. */
	typeImports?: string[];
}

const PACKAGES: PackageSpec[] = [
	{
		dir: 'svg-renderer',
		files: ['LICENSE', 'README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts'],
		types: 'dist/index.d.ts',
	},
	{
		dir: 'png-renderer',
		files: ['LICENSE', 'README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts'],
		types: 'dist/index.d.ts',
		// `renderCanvas` returns its `Canvas`, on purpose.
		typeImports: ['@napi-rs/canvas'],
	},
	{
		dir: 'maplibre-svg-export',
		files: [
			'LICENSE',
			'README.md',
			'package.json',
			'dist/maplibre-svg-export.js',
			'dist/maplibre-svg-export.umd.min.js',
			'dist/maplibre-svg-export.d.ts',
		],
		types: 'dist/maplibre-svg-export.d.ts',
	},
];

// --- Preconditions --------------------------------------------------------
for (const spec of PACKAGES) {
	for (const file of spec.files.filter((f) => f.startsWith('dist/'))) {
		if (!existsSync(resolve(repo, 'packages', spec.dir, file))) {
			console.error(red(`Missing packages/${spec.dir}/${file}. Run \`npm run build\` first.`));
			process.exit(1);
		}
	}
}

const work = mkdtempSync(resolve(tmpdir(), 'versatiles-pack-'));
const tarballs: Record<string, string> = {};

try {
	// --- Pack and inspect every package --------------------------------------
	for (const spec of PACKAGES) {
		const pkgDir = resolve(repo, 'packages', spec.dir);
		const manifest = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as {
			name: string;
		};
		console.log(`\n${manifest.name}`);

		const meta = pack(pkgDir);
		tarballs[spec.dir] = resolve(work, meta.filename);
		const shipped = meta.files.map((f) => f.path).sort();
		console.log(
			dim(`  ${meta.filename}, ${String(shipped.length)} files, ${kb(meta.size)} packed`),
		);

		check('tarball ships exactly the expected files', () => {
			const expected = [...spec.files].sort();
			const missing = expected.filter((f) => !shipped.includes(f));
			const extra = shipped.filter((f) => !expected.includes(f));
			assert(missing.length === 0, `missing ${missing.join(', ')}`);
			assert(extra.length === 0, `unexpected ${extra.join(', ')}`);
			return shipped.filter((f) => f.startsWith('dist/')).join(', ');
		});

		check('published types reference only declared dependencies', () => {
			// `@types/geojson` may be referenced, and what `typeImports` lists: declared
			// dependencies. Anything else (maplibre-gl, the style spec, the private core) would
			// make consumers install it just to typecheck. Comments are stripped first, because
			// the documentation's code examples legitimately contain `import … from '…'`.
			const source = readFileSync(resolve(pkgDir, spec.types), 'utf8');
			const references = [...source.matchAll(/\/\/\/\s*<reference\s+types="([^"]+)"/g)].map(
				(m) => m[1],
			);
			const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
			const imports = [
				...code.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g),
			].map((m) => m[1]);
			const allowed = ['geojson', ...(spec.typeImports ?? [])];
			const foreign = [...references, ...imports].filter((m) => !allowed.includes(m!));
			assert(foreign.length === 0, `references ${foreign.join(', ')}`);
			return [...new Set([...references, ...imports])].join(', ');
		});
	}

	if (outDir) {
		const target = resolve(repo, outDir);
		mkdirSync(target, { recursive: true });
		for (const tarball of Object.values(tarballs)) {
			copyFileSync(tarball, resolve(target, tarball.split('/').pop()!));
		}
	}

	// --- @versatiles/svg-renderer ---------------------------------------------
	console.log('\n@versatiles/svg-renderer, installed alone');
	{
		const consumer = createConsumer('svg', [tarballs['svg-renderer']!]);

		check('renders an SVG', () =>
			runModule(
				`const { renderToSVG } = await import('@versatiles/svg-renderer');
				const svg = await renderToSVG({ style: ${MINIMAL_STYLE}, width: 16, height: 16 });
				if (!svg.startsWith('<svg')) throw new Error('not an SVG: ' + svg.slice(0, 40));
				console.log(svg.length + ' bytes');`,
				consumer,
			),
		);

		check('renders several views with SVGMapRenderer', () =>
			runModule(
				`const { SVGMapRenderer } = await import('@versatiles/svg-renderer');
				const map = new SVGMapRenderer({ style: ${MINIMAL_STYLE} });
				for (const zoom of [1, 2]) {
					const svg = await map.renderSVG({ width: 16, height: 16, zoom });
					if (!svg.startsWith('<svg')) throw new Error('not an SVG: ' + svg.slice(0, 40));
				}
				console.log('2 views');`,
				consumer,
			),
		);

		check('require() of the ES module works (Node ≥ 22.12)', () =>
			runCommonJS(
				`const { renderToSVG, SVGMapRenderer } = require('@versatiles/svg-renderer');
				if (typeof renderToSVG !== 'function') throw new Error('renderToSVG missing');
				if (typeof SVGMapRenderer !== 'function') throw new Error('SVGMapRenderer missing');
				console.log('renderToSVG, SVGMapRenderer');`,
				consumer,
			),
		);

		checkTypes(
			consumer,
			`import {
				renderToSVG,
				SVGMapRenderer,
				type RenderToSVGOptions,
				type SVGMapRendererOptions,
				type ViewOptions,
				type FetchFunction,
			} from '@versatiles/svg-renderer';
			const options: RenderToSVGOptions = { style: ${MINIMAL_STYLE}, width: 64 };
			export const svg: Promise<string> = renderToSVG(options);
			const mapOptions: SVGMapRendererOptions = { style: ${MINIMAL_STYLE}, tileCacheSize: 0 };
			// Without the DOM or Node's types, a fetch function can still be written out.
			const fetchFn: FetchFunction = (url: string) =>
				Promise.resolve({
					ok: true,
					status: 200,
					headers: { get: () => url },
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
					json: () => Promise.resolve({}),
				});
			export const withFetch = renderToSVG({ style: ${MINIMAL_STYLE}, fetch: fetchFn });
			const view: ViewOptions = { lon: 1, lat: 2, zoom: 3 };
			export const view1: Promise<string> = new SVGMapRenderer(mapOptions).renderSVG(view);`,
		);

		check('the style argument is really typed, not `any`', () => {
			// If `StyleSpecification` cannot be resolved it becomes `any` and every style is
			// accepted — the failure mode that would make the type check above pass for the
			// wrong reason. A style missing a required field must be rejected.
			const output = typecheck(
				consumer,
				`import { renderToSVG } from '@versatiles/svg-renderer';
				export const svg = renderToSVG({ style: { version: 8, sources: {} } });`,
			);
			assert(output.includes('layers'), `a style without "layers" was accepted: ${output}`);
			return 'a style missing "layers" is rejected';
		});
	}

	// --- @versatiles/png-renderer ---------------------------------------------
	console.log('\n@versatiles/png-renderer, installed alone');
	{
		const consumer = createConsumer('png', [tarballs['png-renderer']!]);

		check('installs its native canvas binary as a dependency', () => {
			const napi = resolve(consumer, 'node_modules/@napi-rs');
			const found = existsSync(napi) ? execFileSync('ls', [napi], { encoding: 'utf8' }) : '';
			const binaries = found.split('\n').filter((n) => n.startsWith('canvas-'));
			assert(binaries.length > 0, 'no @napi-rs/canvas-<platform> package installed');
			return binaries.map((n) => `@napi-rs/${n}`).join(', ');
		});

		check('renders a PNG', () =>
			runModule(
				`${ASSERT_PNG}
				const { renderToPNG } = await import('@versatiles/png-renderer');
				console.log(assertPng(await renderToPNG({ style: ${BACKGROUND_STYLE}, width: 32, height: 16, scale: 2 }), 64, 32));`,
				consumer,
			),
		);

		check('also renders an SVG', () =>
			runModule(
				`const { renderToSVG } = await import('@versatiles/png-renderer');
				const svg = await renderToSVG({ style: ${MINIMAL_STYLE}, width: 16, height: 16 });
				if (!svg.startsWith('<svg')) throw new Error('not an SVG');
				console.log('renderToSVG');`,
				consumer,
			),
		);

		check('renders PNG and SVG with PNGMapRenderer', () =>
			runModule(
				`${ASSERT_PNG}
				const { PNGMapRenderer } = await import('@versatiles/png-renderer');
				const map = new PNGMapRenderer({ style: ${BACKGROUND_STYLE} });
				const png = assertPng(await map.renderPNG({ width: 32, height: 16, scale: 2 }), 64, 32);
				const svg = await map.renderSVG({ width: 32, height: 16 });
				if (!svg.startsWith('<svg')) throw new Error('not an SVG');
				console.log(png + ', and an SVG');`,
				consumer,
			),
		);

		check('renders onto a canvas to draw on and encode', () =>
			runModule(
				`const { PNGMapRenderer, renderToCanvas } = await import('@versatiles/png-renderer');
				const canvas = await new PNGMapRenderer({ style: ${BACKGROUND_STYLE} }).renderCanvas({ width: 32, height: 16, scale: 2 });
				if (canvas.width !== 64 || canvas.height !== 32) throw new Error('wrong size');
				canvas.getContext('2d').fillRect(0, 0, 4, 4);
				const webp = await canvas.encode('webp');
				if (webp.subarray(0, 4).toString() !== 'RIFF') throw new Error('not a WebP');
				const other = await renderToCanvas({ style: ${BACKGROUND_STYLE}, width: 8, height: 8 });
				console.log(webp.length + ' bytes of WebP, and ' + other.width + 'x' + other.height + ' from renderToCanvas');`,
				consumer,
			),
		);

		checkTypes(
			consumer,
			`import {
				PNGMapRenderer,
				renderToCanvas,
				renderToPNG,
				renderToSVG,
				SVGMapRenderer,
				type Canvas,
				type PNGMapRendererOptions,
				type PNGViewOptions,
				type RenderToPNGOptions,
			} from '@versatiles/png-renderer';
			const options: RenderToPNGOptions = { style: ${MINIMAL_STYLE}, width: 64, scale: 2 };
			export const png: Promise<Uint8Array> = renderToPNG(options);
			export const svg: Promise<string> = renderToSVG(options);
			const mapOptions: PNGMapRendererOptions = { style: ${MINIMAL_STYLE}, fonts: {} };
			const view: PNGViewOptions = { zoom: 3, scale: 2 };
			const map: SVGMapRenderer = new PNGMapRenderer(mapOptions);
			export const png1: Promise<Uint8Array> = new PNGMapRenderer(mapOptions).renderPNG(view);
			// The canvas is the real one of @napi-rs/canvas, with its whole API.
			const canvas: Canvas = await new PNGMapRenderer(mapOptions).renderCanvas(view);
			canvas.getContext('2d').strokeRect(1, 1, 10, 10);
			export const webp: Promise<Buffer> = canvas.encode('webp', 90);
			export const other: Promise<Canvas> = renderToCanvas(options);
			export const svg1: Promise<string> = map.renderSVG(view);`,
			undefined,
			true,
		);
	}

	console.log('\n@versatiles/png-renderer, installed with --omit=optional (no native binary)');
	{
		const consumer = createConsumer(
			'png-no-binary',
			[tarballs['png-renderer']!],
			['--omit=optional'],
		);

		check('renderToSVG still works', () =>
			runModule(
				`const { renderToSVG } = await import('@versatiles/png-renderer');
				const svg = await renderToSVG({ style: ${MINIMAL_STYLE}, width: 16, height: 16 });
				if (!svg.startsWith('<svg')) throw new Error('not an SVG');
				console.log('renderToSVG');`,
				consumer,
			),
		);

		check('PNGMapRenderer still renders SVG', () =>
			runModule(
				`const { PNGMapRenderer } = await import('@versatiles/png-renderer');
				const svg = await new PNGMapRenderer({ style: ${MINIMAL_STYLE} }).renderSVG({ width: 16, height: 16 });
				if (!svg.startsWith('<svg')) throw new Error('not an SVG');
				console.log('renderSVG');`,
				consumer,
			),
		);

		check('renderToPNG explains the missing binary', () =>
			runModule(
				`const { renderToPNG } = await import('@versatiles/png-renderer');
				try {
					await renderToPNG({ style: ${MINIMAL_STYLE}, width: 8, height: 8 });
				} catch (e) {
					for (const part of [process.platform + '-' + process.arch, '@napi-rs/canvas-', '--omit=optional']) {
						if (!e.message.includes(part)) throw new Error('message lacks ' + part + ': ' + e.message);
					}
					console.log('names platform, package and cause');
					process.exit(0);
				}
				throw new Error('rendered without the binary');`,
				consumer,
			),
		);
	}

	// --- @versatiles/maplibre-svg-export --------------------------------------
	console.log('\n@versatiles/maplibre-svg-export, installed alone');
	{
		const consumer = createConsumer('plugin', [tarballs['maplibre-svg-export']!]);
		const installed = resolve(consumer, 'node_modules/@versatiles/maplibre-svg-export');
		const manifest = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8')) as Record<
			string,
			unknown
		>;

		check('the ES module exports the control', () =>
			runModule(
				`const m = await import('@versatiles/maplibre-svg-export');
				if (typeof m.SVGExportControl !== 'function') throw new Error('SVGExportControl missing');
				if (typeof m.renderToSVG !== 'function') throw new Error('renderToSVG missing');
				if (typeof m.SVGMapRenderer !== 'function') throw new Error('SVGMapRenderer missing');
				console.log(Object.keys(m).sort().join(', '));`,
				consumer,
			),
		);

		check('the UMD bundle sets the VersaTilesSVG global', () => {
			const context: Record<string, unknown> = {};
			context.self = context;
			context.globalThis = context;
			createContext(context);
			const umd = resolve(installed, 'dist/maplibre-svg-export.umd.min.js');
			runInContext(readFileSync(umd, 'utf8'), context);
			const global = context.VersaTilesSVG as Record<string, unknown> | undefined;
			assert(
				typeof global?.SVGExportControl === 'function',
				'VersaTilesSVG.SVGExportControl missing',
			);
			assert(typeof global.renderToSVG === 'function', 'VersaTilesSVG.renderToSVG missing');
			assert(typeof global.SVGMapRenderer === 'function', 'VersaTilesSVG.SVGMapRenderer missing');
			return Object.keys(global).sort().join(', ');
		});

		check('jsdelivr, unpkg and browser point at shipped files', () => {
			for (const field of ['jsdelivr', 'unpkg', 'browser']) {
				const file = manifest[field];
				assert(typeof file === 'string', `"${field}" is not set`);
				assert(existsSync(resolve(installed, file)), `"${field}": ${file} is not shipped`);
			}
			return String(manifest.jsdelivr);
		});

		checkTypes(
			consumer,
			`import {
				SVGExportControl,
				SVGMapRenderer,
				renderToSVG,
				type FetchFunction,
			} from '@versatiles/maplibre-svg-export';
			// The browser's own fetch fits the option as is.
			export const browserFetch: FetchFunction = fetch;
			// Stands in for maplibre-gl's Map, which the consumer does not need to install.
			declare const map: { addControl(control: { onAdd(map: never): HTMLElement }): void };
			map.addControl(new SVGExportControl({ defaultWidth: 800, defaultHeight: 600 }));
			export const svg: Promise<string> = renderToSVG({ style: ${MINIMAL_STYLE} });
			export const svg1: Promise<string> = new SVGMapRenderer({ style: ${MINIMAL_STYLE} }).renderSVG();`,
			['DOM', 'ES2022'],
		);
	}

	// --- GitHub release asset ---------------------------------------------------
	console.log('\nmaplibre-svg-export.tar.gz (GitHub release asset)');
	check('contains the browser bundles, types, README and LICENSE', () => {
		execFileSync('npm', ['run', '--silent', 'build:browser-tarball'], { cwd: repo });
		const archive = resolve(repo, 'release/maplibre-svg-export.tar.gz');
		const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
			.sort();
		const expected = [
			'LICENSE',
			'README.md',
			'maplibre-svg-export.d.ts',
			'maplibre-svg-export.js',
			'maplibre-svg-export.umd.min.js',
		];
		assert(JSON.stringify(listed) === JSON.stringify(expected), `contains ${listed.join(', ')}`);
		const extracted = resolve(work, 'browser-tarball');
		mkdirSync(extracted);
		execFileSync('tar', ['-xzf', archive, '-C', extracted]);
		const inTarball = readFileSync(resolve(extracted, 'maplibre-svg-export.umd.min.js'));
		const inDist = readFileSync(
			resolve(repo, 'packages/maplibre-svg-export/dist/maplibre-svg-export.umd.min.js'),
		);
		assert(inTarball.equals(inDist), 'the UMD bundle differs from dist/');
		return `${String(listed.length)} files, flat`;
	});

	// --- Linux containers ---------------------------------------------------------
	if (withDocker) {
		for (const image of ['node:22-slim', 'node:24-alpine']) {
			console.log(`\n@versatiles/png-renderer in ${image}`);
			check('installs the matching binary and renders a PNG', () =>
				runInDocker(image, tarballs['png-renderer']!),
			);
		}
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
	console.log(red(`\n${String(failures)} packaging check(s) failed.`));
	process.exitCode = 1;
} else {
	console.log(
		green(
			`\nAll packages install and work.${withDocker ? '' : dim(' (Linux containers skipped; pass --docker)')}`,
		),
	);
	if (outDir) console.log(dim(`Tarballs kept in ${outDir}/`));
}

// --- Helpers --------------------------------------------------------------------

interface PackResult {
	filename: string;
	files: { path: string }[];
	size: number;
}

function pack(pkgDir: string): PackResult {
	const output = execFileSync(
		'npm',
		['pack', '--ignore-scripts', '--json', '--pack-destination', work],
		{ cwd: pkgDir, encoding: 'utf8' },
	);
	// npm has reported this as an array and, more recently, as an object keyed by package
	// name; accept either so the check does not break on an npm upgrade.
	const parsed = JSON.parse(output) as PackResult[] | Record<string, PackResult>;
	return (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0])!;
}

/** An empty ES module project with the given tarballs installed from the registry's view. */
function createConsumer(name: string, packages: string[], npmArgs: string[] = []): string {
	const consumer = resolve(work, `consumer-${name}`);
	mkdirSync(consumer);
	writeFileSync(
		resolve(consumer, 'package.json'),
		JSON.stringify({ name: `consumer-${name}`, version: '1.0.0', type: 'module', private: true }),
	);
	execFileSync(
		'npm',
		['install', '--no-audit', '--no-fund', '--silent', '--prefer-offline', ...npmArgs, ...packages],
		{ cwd: consumer, encoding: 'utf8' },
	);
	return consumer;
}

/**
 * Typechecks `code` in the consumer and returns tsc's output ('' when it passes).
 *
 * Only the compiler is provided, and no `@types/geojson`: each package declares it, so
 * installing the tarball brings it along. No `@types/node` either, unless `nodeTypes` is
 * set: the SVG packages must not depend on Node's ambient globals. png-renderer needs
 * them, since the types of the `Canvas` its `renderCanvas` returns do.
 */
function typecheck(
	consumer: string,
	code: string,
	lib: string[] = ['ES2022'],
	nodeTypes = false,
): string {
	const provided = ['typescript', ...(nodeTypes ? ['@types/node', 'undici-types'] : [])];
	for (const name of provided) {
		const link = resolve(consumer, 'node_modules', name);
		mkdirSync(dirname(link), { recursive: true });
		if (!existsSync(link)) symlinkSync(resolve(repo, 'node_modules', name), link, 'dir');
	}
	writeFileSync(resolve(consumer, 'consumer.ts'), code);
	writeFileSync(
		resolve(consumer, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				module: 'node16',
				moduleResolution: 'node16',
				target: 'ES2022',
				lib,
				types: nodeTypes ? ['node'] : [],
				strict: true,
				noEmit: true,
				// Deliberately off: the published .d.ts files must stand on their own. With it
				// on, a type this package cannot resolve silently degrades to `any` instead of
				// failing, which is exactly the bug this guards against.
				skipLibCheck: false,
			},
			include: ['consumer.ts'],
		}),
	);
	try {
		execFileSync(resolve(repo, 'node_modules/.bin/tsc'), ['-p', consumer], { encoding: 'utf8' });
		return '';
	} catch (error) {
		return ((error as { stdout?: string }).stdout ?? String(error)).trim();
	}
}

function checkTypes(consumer: string, code: string, lib?: string[], nodeTypes = false): void {
	check('a strict consumer typechecks against the published types', () => {
		const output = typecheck(consumer, code, lib, nodeTypes);
		assert(output === '', output);
		return `node16 resolution, skipLibCheck off, ${nodeTypes ? 'with' : 'no'} @types/node`;
	});
}

/**
 * Installs png-renderer inside a container and renders a PNG there.
 *
 * Nothing is spliced into shell code: the check is written to a file next to the tarball
 * (the directory is mounted read-only), and the tarball's name is passed to `sh` as a
 * positional argument.
 */
function runInDocker(image: string, tarball: string): string {
	writeFileSync(
		resolve(dirname(tarball), 'docker-check.mjs'),
		`${ASSERT_PNG}
		const { renderToPNG } = await import('@versatiles/png-renderer');
		const png = await renderToPNG({ style: ${BACKGROUND_STYLE}, width: 32, height: 16 });
		const binaries = (await import('node:fs')).readdirSync('node_modules/@napi-rs').filter((n) => n !== 'canvas');
		console.log(assertPng(png, 32, 16) + ' via ' + binaries.join(', '));\n`,
	);
	const script = [
		'set -e',
		'mkdir /app && cd /app',
		'cp "/tarballs/$1" package.tgz',
		'cp /tarballs/docker-check.mjs .',
		`echo '{"name":"consumer","version":"1.0.0","type":"module","private":true}' > package.json`,
		'npm install --no-audit --no-fund --silent ./package.tgz',
		'node docker-check.mjs',
	].join('\n');
	const result = spawnSync(
		'docker',
		[
			'run',
			'--rm',
			'-v',
			`${dirname(tarball)}:/tarballs:ro`,
			image,
			'sh',
			'-c',
			script,
			'sh', // $0
			basename(tarball), // $1
		],
		{ encoding: 'utf8' },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw Object.assign(new Error(`docker exited with ${String(result.status)}`), {
			stdout: `${result.stdout}\n${result.stderr}`,
		});
	}
	return result.stdout.trim().split('\n').pop() ?? '';
}

function kb(bytes: number): string {
	return `${(bytes / 1024).toFixed(0)} KB`;
}
