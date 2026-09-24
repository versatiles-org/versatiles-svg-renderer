import { describe, expect, test } from 'vitest';
import { bleedAtTileBorder, meshTriangles, rasterFilter, tileOverlap } from './raster.js';
import type { RasterTriangle } from '../geo/index.js';
import type { RasterStyle } from '../types.js';

function style(overrides: Partial<RasterStyle> = {}): RasterStyle {
	return {
		opacity: 1,
		hueRotate: 0,
		brightnessMin: 0,
		brightnessMax: 1,
		saturation: 0,
		contrast: 0,
		resampling: 'linear',
		...overrides,
	};
}

describe('rasterFilter', () => {
	test('is empty without adjustments', () => {
		expect(rasterFilter(style())).toBe('');
	});

	test('lists each adjustment as a CSS filter function', () => {
		expect(
			rasterFilter(style({ hueRotate: 90, saturation: -0.5, contrast: 0.25, brightnessMin: 0.2 })),
		).toBe('hue-rotate(90deg) saturate(0.5) contrast(1.25) brightness(0.6)');
	});
});

describe('tileOverlap', () => {
	test('is a ten-thousandth of the tile’s shorter side', () => {
		expect(tileOverlap({ width: 512, height: 256 })).toBe(0.0256);
	});
});

describe('meshTriangles', () => {
	const inner: RasterTriangle = {
		source: [
			[0.2, 0.2],
			[0.8, 0.2],
			[0.2, 0.8],
		],
		target: [
			[20, 20],
			[80, 20],
			[20, 80],
		],
	};
	const border: RasterTriangle = {
		source: [
			[0, 0],
			[1, 0],
			[0, 1],
		],
		target: [
			[0, 0],
			[100, 0],
			[0, 100],
		],
	};

	test('draws the border triangles as an underlay first, then every triangle', () => {
		const result = meshTriangles([{ image: 'a', triangles: [inner, border], standalone: false }]);
		expect(result).toEqual([
			{
				image: 'a',
				source: bleedAtTileBorder(border.source, border.target),
				target: border.target,
			},
			{ image: 'a', ...inner },
			{ image: 'a', ...border },
		]);
	});

	test('gives a standalone tile no underlay', () => {
		const result = meshTriangles([{ image: 'a', triangles: [border], standalone: true }]);
		expect(result).toEqual([{ image: 'a', ...border }]);
	});

	test('draws the underlays of all tiles before any tile', () => {
		const result = meshTriangles([
			{ image: 'a', triangles: [border], standalone: false },
			{ image: 'b', triangles: [border], standalone: false },
		]);
		expect(result.map(({ image, source }) => [image, source === border.source])).toEqual([
			['a', false],
			['b', false],
			['a', true],
			['b', true],
		]);
	});
});
