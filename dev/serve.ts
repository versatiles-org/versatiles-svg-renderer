import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { watch } from 'node:fs';

const PORT = 3000;
const ROOT = resolve(import.meta.dirname, '..');
const DEV_DIR = resolve(ROOT, 'dev');
const DIST_DIR = resolve(ROOT, 'packages/maplibre-svg-export/dist');

const MIME_TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.map': 'application/json',
};

function buildMaplibre(): void {
	console.log('Building maplibre plugin...');
	try {
		execSync(
			'npx rollup -c rollup.config.ts --configPlugin @rollup/plugin-typescript --environment PACKAGE:maplibre-svg-export',
			{ cwd: ROOT, stdio: 'pipe' },
		);
		console.log('Build complete.');
	} catch (e: unknown) {
		const err = e as { stderr?: Buffer };
		console.error('Build failed:', err.stderr?.toString() ?? e);
	}
}

// Initial build
buildMaplibre();

// Watch the renderer sources for changes and rebuild
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(resolve(ROOT, 'packages/core/src'), { recursive: true }, (_event, filename) => {
	if (!filename?.endsWith('.ts')) return;
	if (debounce) clearTimeout(debounce);
	debounce = setTimeout(() => {
		console.log(`\nFile changed: ${filename}`);
		buildMaplibre();
	}, 300);
});

// Serve files
const server = createServer((req, res) => {
	const url = req.url ?? '/';
	let filePath: string;

	if (url === '/' || url === '/index.html') {
		filePath = resolve(DEV_DIR, 'index.html');
	} else if (url.startsWith('/dist/')) {
		filePath = resolve(DIST_DIR, url.slice(6));
	} else {
		res.writeHead(404);
		res.end('Not found');
		return;
	}

	if (!existsSync(filePath)) {
		res.writeHead(404);
		res.end('Not found');
		return;
	}

	const ext = extname(filePath);
	const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

	res.writeHead(200, {
		'Content-Type': contentType,
		'Cache-Control': 'no-store',
	});
	res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
	console.log(`\nDev server running at http://localhost:${String(PORT)}/`);
	console.log('Watching packages/core/src/ for changes...\n');
});
