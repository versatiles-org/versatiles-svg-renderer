import { describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { loadCanvasBackend, missingBackendMessage, nativePackageName } from './canvas_backend.js';
import { renderToPNG } from './png.js';

const minimalStyle = {
	version: 8 as const,
	sources: {},
	layers: [],
};

describe('loadCanvasBackend', () => {
	test('resolves the canvas backend', async () => {
		const backend = await loadCanvasBackend();
		expect(typeof backend.createCanvas).toBe('function');
	});

	test('caches the backend across calls', async () => {
		const [first, second] = await Promise.all([loadCanvasBackend(), loadCanvasBackend()]);
		expect(first).toBe(second);
	});

	test('explains a missing binary, keeping the original error as the cause', async () => {
		vi.resetModules();
		vi.doMock('@napi-rs/canvas', () => {
			throw new Error('Cannot find native binding.');
		});
		const backend = await import('./canvas_backend.js');
		const error: unknown = await backend.loadCanvasBackend().then(
			() => undefined,
			(e: unknown) => e,
		);
		vi.doUnmock('@napi-rs/canvas');
		vi.resetModules();

		if (!(error instanceof Error)) throw new Error('expected loadCanvasBackend() to reject');
		expect(error.message).toContain(`${process.platform}-${process.arch}`);
		expect(error.message).toContain('--omit=optional');
		// Vitest wraps an error thrown by a mock factory, so only check that one is attached.
		expect(error.cause).toBeInstanceOf(Error);
	});
});

describe('nativePackageName', () => {
	test.each([
		['darwin', 'arm64', false, '@napi-rs/canvas-darwin-arm64'],
		['darwin', 'x64', false, '@napi-rs/canvas-darwin-x64'],
		['linux', 'x64', false, '@napi-rs/canvas-linux-x64-gnu'],
		['linux', 'x64', true, '@napi-rs/canvas-linux-x64-musl'],
		['linux', 'arm64', true, '@napi-rs/canvas-linux-arm64-musl'],
		['linux', 'arm', false, '@napi-rs/canvas-linux-arm-gnueabihf'],
		['linux', 'riscv64', false, '@napi-rs/canvas-linux-riscv64-gnu'],
		['win32', 'x64', false, '@napi-rs/canvas-win32-x64-msvc'],
		['win32', 'arm64', false, '@napi-rs/canvas-win32-arm64-msvc'],
		['android', 'arm64', false, '@napi-rs/canvas-android-arm64'],
	])('%s %s (musl: %s) → %s', (platform, arch, musl, expected) => {
		expect(nativePackageName(platform, arch, musl)).toBe(expected);
	});

	test.each([
		['freebsd', 'x64', false],
		['linux', 'ia32', false],
		['linux', 'riscv64', true],
		['win32', 'ia32', false],
	])('%s %s (musl: %s) has no binary', (platform, arch, musl) => {
		expect(nativePackageName(platform, arch, musl)).toBeUndefined();
	});
});

describe('missingBackendMessage', () => {
	test('names the platform, the missing package and the usual causes', () => {
		const message = missingBackendMessage('linux', 'arm64', true);
		expect(message).toContain('(linux-arm64-musl)');
		expect(message).toContain('"@napi-rs/canvas-linux-arm64-musl"');
		expect(message).toContain('--omit=optional');
		expect(message).toContain('Docker');
		expect(message).toContain('renderToSVG() works without it');
	});

	test('says so when the platform has no binary at all', () => {
		const message = missingBackendMessage('freebsd', 'x64', false);
		expect(message).toContain('no prebuilt binary for this platform (freebsd-x64)');
		expect(message).not.toContain('--omit=optional');
	});
});

describe('renderToPNG', () => {
	test.each([
		['width', { width: 0 }, 'width must be positive'],
		['height', { height: -1 }, 'height must be positive'],
		['scale', { scale: 0 }, 'scale must be positive'],
	])('rejects a non-positive %s', async (_name, overrides, message) => {
		await expect(renderToPNG({ style: minimalStyle, ...overrides })).rejects.toThrow(message);
	});

	const backgroundStyle = {
		version: 8 as const,
		sources: {},
		layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#0000ff' } }],
	};

	// PNG dimensions live in the IHDR chunk, right after the 8-byte signature.
	const pngSize = (png: Uint8Array): [number, number] => {
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		return [view.getUint32(16), view.getUint32(20)];
	};

	test('renders a PNG at the requested size', async () => {
		const png = await renderToPNG({ style: minimalStyle, width: 64, height: 32 });
		expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(pngSize(png)).toEqual([64, 32]);
	});

	test('scale multiplies the pixel size, not the map size', async () => {
		const png = await renderToPNG({ style: minimalStyle, width: 64, height: 32, scale: 2 });
		expect(pngSize(png)).toEqual([128, 64]);
	});

	test('draws the style it is given', async () => {
		const png = await renderToPNG({ style: backgroundStyle, width: 16, height: 16 });
		const { createCanvas, loadImage } = await loadCanvasBackend();
		const canvas = createCanvas(16, 16);
		const ctx = canvas.getContext('2d');
		ctx.drawImage(await loadImage(png), 0, 0);
		expect([...ctx.getImageData(8, 8, 1, 1).data]).toEqual([0, 0, 255, 255]);
	});

	describe('fonts', () => {
		const notoSans = createRequire(import.meta.url).resolve(
			'@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2',
		);

		test('registers a font under the name the style uses', async () => {
			await renderToPNG({
				style: minimalStyle,
				width: 8,
				height: 8,
				fonts: { a_style_font_name: notoSans },
			});
			const { GlobalFonts } = await loadCanvasBackend();
			expect(GlobalFonts.has('a_style_font_name')).toBe(true);
		});

		test('reports which font file could not be registered', async () => {
			await expect(
				renderToPNG({
					style: minimalStyle,
					width: 8,
					height: 8,
					fonts: { broken: '/no/such/font.ttf' },
				}),
			).rejects.toThrow(/"broken" from \/no\/such\/font\.ttf/);
		});
	});

	test('renders a symbol layer when labels are enabled', async () => {
		const symbolStyle = {
			version: 8 as const,
			sources: {
				points: {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: [
							{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
						],
					},
				} as unknown as StyleSpecification['sources'][string],
			},
			layers: [
				{
					id: 'labels',
					type: 'symbol' as const,
					source: 'points',
					layout: { 'text-field': 'X', 'text-size': 32 },
					paint: { 'text-color': '#ff0000' },
				},
			],
		};

		const png = await renderToPNG({
			style: symbolStyle,
			renderLabels: true,
			width: 64,
			height: 64,
		});
		const { createCanvas, loadImage } = await loadCanvasBackend();
		const canvas = createCanvas(64, 64);
		const ctx = canvas.getContext('2d');
		ctx.drawImage(await loadImage(png), 0, 0);
		const { data } = ctx.getImageData(0, 0, 64, 64);
		let painted = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++;
		expect(painted).toBeGreaterThan(0);
	});
});
