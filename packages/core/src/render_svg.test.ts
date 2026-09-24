import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RenderJob } from './renderer/types.js';

vi.mock('./pipeline/render.js', () => ({
	drawMap: vi.fn((job: RenderJob) => Promise.resolve(job.renderer)),
}));

const { drawMap } = await import('./pipeline/render.js');
const { renderToSVG } = await import('./render_svg.js');

describe('renderToSVG', () => {
	const minimalStyle = {
		version: 8 as const,
		sources: {},
		layers: [],
	};

	beforeEach(() => {
		vi.mocked(drawMap).mockClear();
	});

	test('returns SVG string', async () => {
		const result = await renderToSVG({ style: minimalStyle });
		expect(result).toMatch(/^<svg/);
	});

	test('passes default options to drawMap', async () => {
		await renderToSVG({ style: minimalStyle });
		expect(drawMap).toHaveBeenCalledWith(
			expect.objectContaining({
				style: minimalStyle,
				view: { center: [0, 0], zoom: 2, bearing: 0 },
				renderLabels: false,
				renderer: expect.objectContaining({ width: 1024, height: 1024 }) as unknown,
			}),
			expect.anything(),
		);
	});

	test('passes custom options', async () => {
		await renderToSVG({
			style: minimalStyle,
			width: 800,
			height: 600,
			lon: 13.4,
			lat: 52.5,
			zoom: 10,
			renderLabels: true,
		});
		expect(drawMap).toHaveBeenCalledWith(
			expect.objectContaining({
				view: { center: [13.4, 52.5], zoom: 10, bearing: 0 },
				renderLabels: true,
				renderer: expect.objectContaining({ width: 800, height: 600 }) as unknown,
			}),
			expect.anything(),
		);
	});

	test('throws on non-positive width', async () => {
		await expect(renderToSVG({ style: minimalStyle, width: 0 })).rejects.toThrow(
			'width must be positive',
		);
		await expect(renderToSVG({ style: minimalStyle, width: -1 })).rejects.toThrow(
			'width must be positive',
		);
	});

	test('throws on non-positive height', async () => {
		await expect(renderToSVG({ style: minimalStyle, height: 0 })).rejects.toThrow(
			'height must be positive',
		);
	});
});
