import { describe, expect, test } from 'vitest';
import type { Color, Feature, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
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

	describe('evaluate', () => {
		test('evaluates constant paint properties', () => {
			const layer = new StyleLayer(
				makeBackground({ 'background-color': '#ff0000', 'background-opacity': 0.5 }),
			);
			const { paint } = layer.evaluate({ zoom: 10 }, []);

			const color = paint.get('background-color');
			expect(color).toBeDefined();
			const opacity = paint.get('background-opacity');
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
			expect(layer.evaluate({ zoom: 0 }, []).paint.get('background-opacity')).toBe(0);
			expect(layer.evaluate({ zoom: 20 }, []).paint.get('background-opacity')).toBe(1);
		});

		test('returns independent results, so one layer can serve concurrent renders', () => {
			const layer = new StyleLayer(
				makeFill({
					paint: {
						'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0, 20, 1],
						'fill-color': ['interpolate', ['linear'], ['zoom'], 0, '#000', 20, ['get', 'color']],
					},
				}),
			);
			const low = layer.evaluate({ zoom: 0 }, []);
			const high = layer.evaluate({ zoom: 20 }, []);

			expect(low.paint.get('fill-opacity')).toBe(0);
			expect(high.paint.get('fill-opacity')).toBe(1);

			// Data-driven values keep the zoom they were evaluated at.
			const feature = { type: 1, properties: { color: '#fff' } } as unknown as Feature;
			const lowColor = low.paint.get('fill-color') as PossiblyEvaluatedPropertyValue<Color>;
			const highColor = high.paint.get('fill-color') as PossiblyEvaluatedPropertyValue<Color>;
			expect(lowColor.evaluate(feature, {}).toString()).toBe('rgba(0,0,0,1)');
			expect(highColor.evaluate(feature, {}).toString()).toBe('rgba(255,255,255,1)');
		});

		test('wraps source expressions in PossiblyEvaluatedPropertyValue', () => {
			const layer = new StyleLayer(
				makeFill({
					paint: {
						'fill-color': ['get', 'color'],
					},
				}),
			);
			const { paint } = layer.evaluate({ zoom: 10 }, []);

			const value = paint.get('fill-color');
			expect(value).toBeInstanceOf(PossiblyEvaluatedPropertyValue);
		});

		test('evaluates layout properties', () => {
			const layer = new StyleLayer(
				makeFill({
					layout: { 'fill-sort-key': 5 },
				}),
			);
			const { layout } = layer.evaluate({ zoom: 10 }, []);

			const sortKey = layout.get('fill-sort-key');
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
