import { describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { loadCanvasBackend } from './renderer/canvas_backend.js';
import { renderToPNG } from './png.js';

const minimalStyle = {
	version: 8 as const,
	sources: {},
	layers: [],
};

describe('loadCanvasBackend', () => {
	test('resolves the optional canvas backend', async () => {
		const backend = await loadCanvasBackend();
		expect(typeof backend.createCanvas).toBe('function');
	});

	test('caches the backend across calls', async () => {
		const [first, second] = await Promise.all([loadCanvasBackend(), loadCanvasBackend()]);
		expect(first).toBe(second);
	});

	test('explains how to install the backend when it is missing', async () => {
		vi.resetModules();
		vi.doMock('@napi-rs/canvas', () => {
			throw new Error("Cannot find package '@napi-rs/canvas'");
		});
		const backend = await import('./renderer/canvas_backend.js');
		await expect(backend.loadCanvasBackend()).rejects.toThrow(/npm install @napi-rs\/canvas/);
		vi.doUnmock('@napi-rs/canvas');
		vi.resetModules();
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
