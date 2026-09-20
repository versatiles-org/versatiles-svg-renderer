/**
 * Packs the package and consumes it the way a user would.
 *
 * `npm run build` only proves the bundles compile. It says nothing about whether the
 * published artifact is usable: whether every `exports` subpath resolves, whether `files`
 * ships what the entry points need, whether the CommonJS builds load, whether the public
 * `.d.ts` files typecheck without the dev-only packages, and whether `./png` degrades
 * gracefully when its optional peer dependency is absent. This checks all of that against
 * a real tarball installed into a throwaway project.
 *
 * `npm pack` runs with `--ignore-scripts`, so `prepack` (docs + build) is not exercised
 * here; the tarball is packed from whatever `dist/` currently holds.
 */
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
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
		for (const line of (output || message).split('\n').slice(0, 6)) {
			console.log(red(`      ${line}`));
		}
	}
}

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

/** Runs a snippet of Node in the consumer project and returns its stdout. */
function inConsumer(code: string, cwd: string): string {
	return execFileSync(process.execPath, ['-e', code], { cwd, encoding: 'utf8' }).trim();
}

const MINIMAL_STYLE = '{version:8,sources:{},layers:[]}';
const BACKGROUND_STYLE =
	"{version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#0000ff'}}]}";

// --- Preconditions --------------------------------------------------------
for (const file of ['dist/index.js', 'dist/index.cjs', 'dist/png.js', 'dist/png.d.ts']) {
	if (!existsSync(resolve(repo, file))) {
		console.error(red(`Missing ${file}. Run \`npm run build\` first.`));
		process.exit(1);
	}
}

const work = mkdtempSync(resolve(tmpdir(), 'versatiles-pack-'));
const consumer = resolve(work, 'consumer');
await mkdir(consumer, { recursive: true });

try {
	// --- Pack -------------------------------------------------------------
	console.log('Packing…');
	const packed = execFileSync(
		'npm',
		['pack', '--ignore-scripts', '--json', '--pack-destination', work],
		{ cwd: repo, encoding: 'utf8' },
	);
	// npm has reported this as an array and, more recently, as an object keyed by package
	// name; accept either so the check does not break on an npm upgrade.
	interface PackResult {
		filename: string;
		files: { path: string }[];
		size: number;
	}
	const parsed = JSON.parse(packed) as PackResult[] | Record<string, PackResult>;
	const meta = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0])!;
	const tarball = resolve(work, meta.filename);
	const shipped = meta.files.map((f) => f.path);
	console.log(
		dim(`  ${meta.filename}, ${shipped.length} files, ${(meta.size / 1024).toFixed(0)} KB\n`),
	);

	check('tarball ships every entry point', () => {
		for (const file of [
			'dist/index.js',
			'dist/index.cjs',
			'dist/index.d.ts',
			'dist/png.js',
			'dist/png.cjs',
			'dist/png.d.ts',
			'dist/maplibre-svg-export.js',
			'dist/maplibre-svg-export.umd.js',
			'dist/maplibre-svg-export.d.ts',
		]) {
			assert(shipped.includes(file), `missing ${file}`);
		}
		return `${shipped.length} files`;
	});

	check('tarball ships no source maps', () => {
		const maps = shipped.filter((f) => f.endsWith('.map'));
		assert(maps.length === 0, `found ${maps.join(', ')}`);
		return 'none';
	});

	check('public types do not leak the optional peer dependency', () => {
		// `./png` must typecheck for consumers who have not installed @napi-rs/canvas, so
		// no exported signature may mention it.
		const types = readFileSync(resolve(repo, 'dist/png.d.ts'), 'utf8');
		assert(!types.includes('@napi-rs/canvas'), 'dist/png.d.ts imports @napi-rs/canvas');
		return 'dist/png.d.ts is clean';
	});

	// --- Install as a consumer --------------------------------------------
	writeFileSync(
		resolve(consumer, 'package.json'),
		JSON.stringify({ name: 'consumer', version: '1.0.0', type: 'module', private: true }, null, 2),
	);
	execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', tarball], {
		cwd: consumer,
		encoding: 'utf8',
	});

	// --- Runtime: every subpath, both module systems ------------------------
	check('ESM: the main entry renders an SVG', () =>
		inConsumer(
			`import('@versatiles/svg-renderer').then(async (m) => {
				const svg = await m.renderToSVG({ style: ${MINIMAL_STYLE}, width: 16, height: 16 });
				if (!svg.startsWith('<svg')) throw new Error('not an SVG: ' + svg.slice(0, 40));
				console.log(svg.length + ' bytes');
			}).catch((e) => { console.error(e.message); process.exit(1); })`,
			consumer,
		),
	);

	check('ESM: the png entry exports renderToPNG', () =>
		inConsumer(
			`import('@versatiles/svg-renderer/png').then((m) => {
				if (typeof m.renderToPNG !== 'function') throw new Error('renderToPNG missing');
				console.log(Object.keys(m).sort().join(', '));
			}).catch((e) => { console.error(e.message); process.exit(1); })`,
			consumer,
		),
	);

	check('ESM: the maplibre entry exports the control', () =>
		inConsumer(
			`import('@versatiles/svg-renderer/maplibre').then((m) => {
				if (typeof m.SVGExportControl !== 'function') throw new Error('SVGExportControl missing');
				console.log(Object.keys(m).sort().join(', '));
			}).catch((e) => { console.error(e.message); process.exit(1); })`,
			consumer,
		),
	);

	check('CJS: require() works for both Node entries', () =>
		inConsumer(
			`const main = require('@versatiles/svg-renderer');
			 const png = require('@versatiles/svg-renderer/png');
			 if (typeof main.renderToSVG !== 'function') throw new Error('renderToSVG missing');
			 if (typeof png.renderToPNG !== 'function') throw new Error('renderToPNG missing');
			 console.log('both resolve');`,
			consumer,
		),
	);

	// --- The optional peer dependency ---------------------------------------
	check('renderToPNG explains itself when the canvas backend is missing', () =>
		inConsumer(
			`import('@versatiles/svg-renderer/png').then(async (m) => {
				try {
					await m.renderToPNG({ style: ${MINIMAL_STYLE}, width: 8, height: 8 });
				} catch (e) {
					if (!/npm install @napi-rs\\/canvas/.test(e.message)) throw new Error('unhelpful: ' + e.message);
					console.log('points at the install command');
					return;
				}
				throw new Error('rendered without the backend installed');
			}).catch((e) => { console.error(e.message); process.exit(1); })`,
			consumer,
		),
	);

	// Link rather than install: the backend is a large native package and the repo already
	// has the exact version the peer range allows.
	await mkdir(resolve(consumer, 'node_modules/@napi-rs'), { recursive: true });
	for (const pkg of ['@napi-rs/canvas', ...napiPlatformPackages()]) {
		const target = resolve(repo, 'node_modules', pkg);
		if (!existsSync(target)) continue;
		const link = resolve(consumer, 'node_modules', pkg);
		await mkdir(dirname(link), { recursive: true });
		if (!existsSync(link)) symlinkSync(target, link, 'dir');
	}

	check('renderToPNG renders once the backend is installed', () =>
		inConsumer(
			`import('@versatiles/svg-renderer/png').then(async (m) => {
				const png = await m.renderToPNG({ style: ${BACKGROUND_STYLE}, width: 32, height: 16 });
				const signature = [...png.subarray(0, 4)].join(',');
				if (signature !== '137,80,78,71') throw new Error('not a PNG: ' + signature);
				const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
				const width = view.getUint32(16), height = view.getUint32(20);
				if (width !== 32 || height !== 16) throw new Error('wrong size: ' + width + 'x' + height);
				console.log(png.length + ' bytes, ' + width + 'x' + height);
			}).catch((e) => { console.error(e.message); process.exit(1); })`,
			consumer,
		),
	);

	// --- Types ---------------------------------------------------------------
	check('a consumer typechecks against the published types', () => {
		// Only the compiler is provided. No `@types/node`: the published types must not
		// depend on Node's ambient globals (which is why `renderToPNG` returns a
		// `Uint8Array` rather than a `Buffer`), and no `@types/geojson` either — the
		// package declares that itself, so installing the tarball brings it along.
		for (const pkg of ['typescript']) {
			const link = resolve(consumer, 'node_modules', pkg);
			// A scoped package needs its scope directory to exist before the link is made.
			mkdirSync(dirname(link), { recursive: true });
			if (!existsSync(link)) symlinkSync(resolve(repo, 'node_modules', pkg), link, 'dir');
		}
		writeFileSync(
			resolve(consumer, 'consumer.ts'),
			`import { renderToSVG } from '@versatiles/svg-renderer';\n` +
				`import { renderToPNG, type RenderToPNGOptions } from '@versatiles/svg-renderer/png';\n` +
				`const options: RenderToPNGOptions = { style: ${MINIMAL_STYLE}, width: 64, scale: 2 };\n` +
				`export const svg = renderToSVG({ style: ${MINIMAL_STYLE} });\n` +
				`export const png = renderToPNG(options);\n`,
		);
		writeFileSync(
			resolve(consumer, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					module: 'node16',
					moduleResolution: 'node16',
					target: 'ES2022',
					lib: ['ESNext'],
					strict: true,
					noEmit: true,
					// Deliberately off: the published .d.ts files must stand on their own. With
					// it on, a type this package cannot resolve silently degrades to `any`
					// instead of failing, which is exactly the bug this guards against.
					skipLibCheck: false,
				},
				include: ['consumer.ts'],
			}),
		);
		execFileSync(resolve(repo, 'node_modules/.bin/tsc'), ['-p', consumer], { encoding: 'utf8' });
		return 'node16 resolution, strict, skipLibCheck off';
	});

	check('the style argument is really typed, not `any`', () => {
		// If `StyleSpecification` cannot be resolved it becomes `any` and every style is
		// accepted — the failure mode that makes the previous check pass for the wrong
		// reason. A style missing a required field must be rejected.
		writeFileSync(
			resolve(consumer, 'consumer.ts'),
			`import { renderToSVG } from '@versatiles/svg-renderer';\n` +
				`export const svg = renderToSVG({ style: { version: 8, sources: {} } });\n`,
		);
		let output = '';
		try {
			execFileSync(resolve(repo, 'node_modules/.bin/tsc'), ['-p', consumer], { encoding: 'utf8' });
		} catch (error) {
			output = (error as { stdout?: string }).stdout ?? '';
		}
		assert(
			output.includes('layers'),
			`a style without "layers" was accepted: ${output || 'no error'}`,
		);
		return 'a style missing "layers" is rejected';
	});
} finally {
	rmSync(work, { recursive: true, force: true });
}

/** The platform-specific binaries npm would install alongside @napi-rs/canvas. */
function napiPlatformPackages(): string[] {
	const pkg = JSON.parse(
		readFileSync(resolve(repo, 'node_modules/@napi-rs/canvas/package.json'), 'utf8'),
	) as { optionalDependencies?: Record<string, string> };
	return Object.keys(pkg.optionalDependencies ?? {});
}

if (failures > 0) {
	console.log(red(`\n${String(failures)} packaging check(s) failed.`));
	process.exitCode = 1;
} else {
	console.log(green('\nThe packed package installs and works.'));
}
