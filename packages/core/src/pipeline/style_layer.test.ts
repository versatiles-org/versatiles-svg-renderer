import { describe, expect, test } from 'vitest';
import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { StyleLayer, createStyleLayer, PossiblyEvaluatedPropertyValue } from './style_layer.js';

function makeBackground(paint?: Record<string, unknown>): LayerSpecification {
	return { id: 'bg', type: 'background', paint };
}

function makeFill(
	opts: { paint?: Record<string, unknown>; layout?: Record<string, unknown> } = {},
): LayerSpecification {
	return {
		id: 'fill1',
		type: 'fill',
		source: 'src',
		'source-layer': 'layer1',
		...opts,
	} as unknown as LayerSpecification;
}

describe('StyleLayer', () => {
	describe('constructor', () => {
		test('sets basic properties from spec', () => {
			const layer = new StyleLayer(makeBackground());
			expect(layer.id).toBe('bg');
			expect(layer.type).toBe('background');
		});

		test('sets source and sourceLayer for non-background layers', () => {
			const layer = new StyleLayer(makeFill());
			expect(layer.source).toBe('src');
			expect(layer.sourceLayer).toBe('layer1');
		});

		test('sets minzoom and maxzoom', () => {
			const spec = { ...makeFill(), minzoom: 5, maxzoom: 15 } as LayerSpecification;
			const layer = new StyleLayer(spec);
			expect(layer.minzoom).toBe(5);
			expect(layer.maxzoom).toBe(15);
		});

		test('handles filter', () => {
			const spec = {
				...makeFill(),
				filter: ['==', 'type', 'park'],
			} as unknown as LayerSpecification;
			const layer = new StyleLayer(spec);
			expect(layer.filter).toEqual(['==', 'type', 'park']);
		});
	});

	describe('isHidden', () => {
		test('returns false for visible layer in zoom range', () => {
			const layer = new StyleLayer(makeBackground());
			expect(layer.isHidden(5)).toBe(false);
		});

		test('returns true when zoom is below minzoom', () => {
			const spec = { ...makeBackground(), minzoom: 10 } as LayerSpecification;
			const layer = new StyleLayer(spec);
			expect(layer.isHidden(5)).toBe(true);
		});

		test('returns true when zoom is at or above maxzoom', () => {
			const spec = { ...makeBackground(), maxzoom: 10 } as LayerSpecification;
			const layer = new StyleLayer(spec);
			expect(layer.isHidden(10)).toBe(true);
			expect(layer.isHidden(9)).toBe(false);
		});

		test('returns true when visibility is none', () => {
			const spec = makeBackground();
			(spec as Record<string, unknown>).layout = { visibility: 'none' };
			const layer = new StyleLayer(spec);
			expect(layer.isHidden(5)).toBe(true);
		});
	});

	describe('recalculate', () => {
		test('evaluates constant paint properties', () => {
			const layer = new StyleLayer(
				makeBackground({ 'background-color': '#ff0000', 'background-opacity': 0.5 }),
			);
			layer.recalculate({ zoom: 10 }, []);

			const color = layer.paint.get('background-color');
			expect(color).toBeDefined();
			const opacity = layer.paint.get('background-opacity');
			expect(opacity).toBe(0.5);
		});

		test('evaluates camera expressions (zoom-dependent)', () => {
			const layer = new StyleLayer(
				makeBackground({
					'background-opacity': {
						stops: [
							[0, 0],
							[20, 1],
						],
					},
				}),
			);
			layer.recalculate({ zoom: 0 }, []);
			expect(layer.paint.get('background-opacity')).toBe(0);

			layer.recalculate({ zoom: 20 }, []);
			expect(layer.paint.get('background-opacity')).toBe(1);
		});

		test('wraps source expressions in PossiblyEvaluatedPropertyValue', () => {
			const layer = new StyleLayer(
				makeFill({
					paint: {
						'fill-color': ['get', 'color'],
					},
				}),
			);
			layer.recalculate({ zoom: 10 }, []);

			const value = layer.paint.get('fill-color');
			expect(value).toBeInstanceOf(PossiblyEvaluatedPropertyValue);
		});

		test('evaluates layout properties', () => {
			const layer = new StyleLayer(
				makeFill({
					layout: { 'fill-sort-key': 5 },
				}),
			);
			layer.recalculate({ zoom: 10 }, []);

			const sortKey = layer.layout.get('fill-sort-key');
			expect(sortKey).toBe(5);
		});
	});
});

describe('createStyleLayer', () => {
	test('returns a StyleLayer instance', () => {
		const layer = createStyleLayer(makeBackground());
		expect(layer).toBeInstanceOf(StyleLayer);
	});
});
