import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { Page } from 'playwright';

// MapLibre GL is served straight from node_modules rather than a CDN, so comparisons
// always run against the version this repo depends on. Since v6 the published package
// is ESM-only — there is no `dist/maplibre-gl.js` UMD bundle to drop in via a plain
// <script> tag anymore.
const maplibreDistDir = resolve(
	import.meta.dirname,
	'..',
	'..',
	'node_modules',
	'maplibre-gl',
	'dist',
);

const CONTENT_TYPES: Record<string, string> = {
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.map': 'application/json',
};

export const MAPLIBRE_PAGE_URL = 'http://localhost/index.html';

// The e2e runs render MapLibre on SwiftShader (headless Chromium, CI has no GPU). Its GLSL
// sin()/cos() are off by up to 1.6e-4 for the arguments of the globe shader: the error is
// periodic in longitude (zero at multiples of 30°, largest in between) and, multiplied by the
// globe radius of ~10^5 px at high zoom, shifts the globe rendering by up to ~40 px. Real GPUs
// compute these to ~1e-7, and so does this renderer — so for a reference that matches MapLibre
// as it renders on real hardware, the globe shader's sin/cos are replaced by a precise version:
// an argument reduction to [-π/4, π/4] (with π/2 split in two float32 parts) followed by short
// Taylor polynomials, accurate to ~3e-7 on SwiftShader as well.
const PRECISE_SIN_COS =
	'vec2 preciseSinCos(float x) {float k=floor(x*0.6366197723675814+0.5);float r=(x-k*1.5707963705062866)-k*(-4.371139000186243e-8);float r2=r*r;float s=r+r*r2*(-0.16666666666666666+r2*(0.008333333333333333+r2*(-0.0001984126984126984+r2*2.7557319223985893e-6)));float c=1.0+r2*(-0.5+r2*(0.041666666666666664+r2*(-0.001388888888888889+r2*2.48015873015873e-5)));int q=int(k-4.0*floor(k/4.0));if (q==1) return vec2(c,-s);if (q==2) return vec2(-s,-c);if (q==3) return vec2(-c,s);return vec2(s,c);}';

const SHADER_PATCHES: [string, string][] = [
	[
		'vec3 projectToSphere(vec2 translatedPos,vec2 rawPos) {',
		`${PRECISE_SIN_COS}vec3 projectToSphere(vec2 translatedPos,vec2 rawPos) {`,
	],
	[
		'vec3 pos=vec3(sin(spherical_x)*cos_sy,sin_sy,cos(spherical_x)*cos_sy',
		'vec2 sin_cos_x=preciseSinCos(spherical_x);vec3 pos=vec3(sin_cos_x.x*cos_sy,sin_sy,sin_cos_x.y*cos_sy',
	],
];

/** MapLibre's main bundle, with the globe shader patched to use a precise sin/cos. */
function readPatchedMapLibre(file: string): string {
	let code = readFileSync(file, 'utf8');
	for (const [search, replacement] of SHADER_PATCHES) {
		// Fail loudly if a MapLibre update changes the shader, instead of silently comparing
		// against the imprecise rendering again.
		if (code.split(search).length !== 2) {
			throw new Error(`Cannot patch the MapLibre globe shader: expected "${search}" exactly once`);
		}
		code = code.replace(search, replacement);
	}
	return code;
}

// Serve the host page and the MapLibre dist files from one local origin, and expose the
// module as `window.maplibregl`. Same-origin matters: MapLibre resolves its worker
// relative to `import.meta.url` and starts it as a module worker, which only works when
// the whole bundle comes from a single http(s) origin.
//
// Register this *after* any catch-all `**/*` route — Playwright uses the last matching one.
export async function installMapLibrePage(
	page: Page,
	{ width, height }: { width: number; height: number },
): Promise<void> {
	await page.route('http://localhost/maplibre/*', async (route) => {
		const name = basename(new URL(route.request().url()).pathname);
		const file = resolve(maplibreDistDir, name);
		if (!existsSync(file)) {
			await route.fulfill({ status: 404, contentType: 'text/plain', body: `not found: ${name}` });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: CONTENT_TYPES[extname(name)] ?? 'application/octet-stream',
			body: name === 'maplibre-gl.mjs' ? readPatchedMapLibre(file) : readFileSync(file),
		});
	});

	await page.route(MAPLIBRE_PAGE_URL, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="/maplibre/maplibre-gl.css">
<script type="module">
import * as maplibregl from '/maplibre/maplibre-gl.mjs';
window.maplibregl = maplibregl;
</script>
<style>* { margin: 0; padding: 0; } #map { width: ${width}px; height: ${height}px; }</style>
</head><body><div id="map"></div></body></html>`,
		});
	});

	await page.goto(MAPLIBRE_PAGE_URL);
	await page.waitForFunction(
		() => typeof (window as unknown as Record<string, unknown>).maplibregl !== 'undefined',
		{
			timeout: 15000,
		},
	);
}
