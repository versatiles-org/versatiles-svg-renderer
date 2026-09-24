import { describe, expect, test, vi, beforeEach, type Mock } from 'vitest';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { SVGRenderer } from '../renderer/svg.js';
import { Feature, Point2D } from '../geometry.js';
import type { IconStyle, LineStyle } from '../renderer/types.js';
import {
	GEOJSON_LAYER,
	type Features,
	type LayerFeatures,
	type SourceFeatures,
} from '../geometry.js';

vi.mock(import('../sources/index.js'), async (importOriginal) => ({
	...(await importOriginal()),
	getLayerFeatures: vi.fn().mockResolvedValue(new Map()),
	getRasterTiles: vi.fn().mockResolvedValue([]),
	loadSpriteAtlas: vi.fn().mockResolvedValue(new Map()),
}));

const { getLayerFeatures, getRasterTiles, loadSpriteAtlas } = await import('../sources/index.js');
const { renderMap } = await import('./render.js');
const { sortByKey } = await import('./layers/layer.js');
const { transformText } = await import('./layers/symbol.js');

function makeStyle(layers: StyleSpecification['layers']): StyleSpecification {
	return { version: 8, sources: {}, layers };
}

function makeJob(style: StyleSpecification, zoom = 10, options?: { renderLabels?: boolean }) {
	return {
		renderer: new SVGRenderer({ width: 256, height: 256 }),
		style,
		view: { center: [0, 0] as [number, number], zoom },
		// The test styles have no glyphs: labels as text.
		labels: options?.renderLabels ? ('text' as const) : undefined,
	};
}

function makeFeatures(opts: Partial<Features> = {}): Features {
	return {
		points: opts.points ?? [],
		linestrings: opts.linestrings ?? [],
		polygons: opts.polygons ?? [],
	};
}

function makePolygonFeature(
	points: [number, number][][],
	properties: Record<string, unknown> = {},
): Feature {
	return new Feature({
		type: 'Polygon',
		properties,
		geometry: points.map((ring) => ring.map(([x, y]) => new Point2D(x, y))),
	});
}

function makeLineFeature(
	points: [number, number][][],
	properties: Record<string, unknown> = {},
): Feature {
	return new Feature({
		type: 'LineString',
		properties,
		geometry: points.map((line) => line.map(([x, y]) => new Point2D(x, y))),
	});
}

function makePointFeature(
	points: [number, number][][],
	properties: Record<string, unknown> = {},
): Feature {
	return new Feature({
		type: 'Point',
		properties,
		geometry: points.map((group) => group.map(([x, y]) => new Point2D(x, y))),
	});
}

function setSourceFeatures(features: SourceFeatures): void {
	(getLayerFeatures as Mock).mockResolvedValue(features);
}

/** Sets the features of the source `src`, which most test layers use. */
function setLayerFeatures(features: LayerFeatures): void {
	setSourceFeatures(new Map([['src', features]]));
}

describe('sortByKey', () => {
	const features = ['a', 'b', 'c', 'd'].map((name) => makePointFeature([[[0, 0]]], { name }));
	const names = (list: Feature[]) => list.map((f) => f.properties.name);

	test('orders by key, lowest first, keeping source order for equal keys', () => {
		const keys: Record<string, number> = { a: 2, b: 1, c: 2, d: 0 };
		expect(names(sortByKey(features, (f) => keys[f.properties.name as string]))).toEqual([
			'd',
			'b',
			'a',
			'c',
		]);
	});

	test('counts a missing key as 0, and keeps the list when all keys are equal', () => {
		const keys: Record<string, unknown> = { a: 1, b: undefined, c: -1, d: null };
		expect(names(sortByKey(features, (f) => keys[f.properties.name as string]))).toEqual([
			'c',
			'b',
			'd',
			'a',
		]);
		expect(sortByKey(features, () => undefined)).toBe(features);
	});
});

describe('transformText', () => {
	test('changes the case as text-transform says', () => {
		expect(transformText('Straße', 'uppercase')).toBe('STRASSE');
		expect(transformText('Berlin', 'lowercase')).toBe('berlin');
		expect(transformText('Berlin', 'none')).toBe('Berlin');
		expect(transformText('Berlin', undefined)).toBe('Berlin');
	});
});

describe('renderMap', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(getLayerFeatures as Mock).mockResolvedValue(new Map());
		(getRasterTiles as Mock).mockResolvedValue([]);
		(loadSpriteAtlas as Mock).mockResolvedValue(new Map());
	});

	test('returns valid SVG for empty style', async () => {
		const result = await renderMap(makeJob(makeStyle([])));
		expect(result).toContain('<svg');
		expect(result).toContain('</svg>');
	});

	test('renders background layer', async () => {
		const style = makeStyle([
			{
				id: 'bg',
				type: 'background',
				paint: {
					'background-color': '#ff0000',
					'background-opacity': 1,
				},
			},
		]);
		const result = await renderMap(makeJob(style));
		expect(result).toContain('<svg');
		expect(result).toContain('fill=');
	});

	test('skips hidden layers (visibility none)', async () => {
		const style = makeStyle([
			{
				id: 'bg',
				type: 'background',
				layout: { visibility: 'none' },
				paint: { 'background-color': '#ff0000' },
			},
		]);
		const result = await renderMap(makeJob(style));
		expect(result).not.toContain('fill=');
	});

	test('skips layers outside zoom range', async () => {
		const style = makeStyle([
			{
				id: 'bg',
				type: 'background',
				minzoom: 15,
				paint: { 'background-color': '#ff0000' },
			},
		]);
		const result = await renderMap(makeJob(style, 10));
		expect(result).not.toContain('fill=');
	});

	test('skips unsupported layer types gracefully', async () => {
		const style = makeStyle([
			{
				id: 'symbols',
				type: 'symbol',
				source: 'src',
				'source-layer': 'labels',
			},
		]);
		const result = await renderMap(makeJob(style));
		expect(result).toContain('<svg');
	});

	test('handles multiple background layers', async () => {
		const style = makeStyle([
			{
				id: 'bg1',
				type: 'background',
				paint: { 'background-color': '#ff0000', 'background-opacity': 1 },
			},
			{
				id: 'bg2',
				type: 'background',
				paint: { 'background-color': '#00ff00', 'background-opacity': 1 },
			},
		]);
		const result = await renderMap(makeJob(style));
		expect(result).toContain('<svg');
		expect(result).toContain('fill=');
	});

	describe('fill layers', () => {
		test('fills with a pattern from the sprite, which it loads also without labels', async () => {
			const sprite = {
				width: 16,
				height: 16,
				x: 0,
				y: 0,
				pixelRatio: 2,
				sdf: false,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 16,
				sheetHeight: 16,
			};
			(loadSpriteAtlas as Mock).mockResolvedValue(new Map([['base:hatch', sprite]]));
			const square = (pattern: string) =>
				makePolygonFeature(
					[
						[
							[0, 0],
							[50, 0],
							[50, 50],
							[0, 0],
						],
					],
					{ pattern },
				);
			setLayerFeatures(
				new Map([['sites', makeFeatures({ polygons: [square('base:hatch'), square('missing')] })]]),
			);
			const job = makeJob(
				makeStyle([
					{
						id: 'sites',
						type: 'fill',
						source: 'src',
						'source-layer': 'sites',
						paint: { 'fill-pattern': ['get', 'pattern'] },
					},
				]),
			);
			const drawPolygons = vi.spyOn(job.renderer, 'drawPolygons');
			await renderMap(job);

			expect(loadSpriteAtlas).toHaveBeenCalled();
			const drawn = drawPolygons.mock.calls[0]![1];
			// The feature whose image is missing is not drawn, as in MapLibre.
			expect(drawn).toHaveLength(1);
			const pattern = drawn[0]![1].pattern!;
			expect(pattern.name).toBe('base:hatch');
			expect(pattern.sprite).toBe(sprite);
			// A corner aligned with the world's origin (for the view at 0/0, zoom 10 on a
			// 256 px image, at 128 − worldSize / 2), whole copies of 8 px away, near the center.
			const worldSize = 512 * 2 ** 10;
			for (const coordinate of pattern.origin) {
				expect((coordinate - (128 - worldSize / 2)) % 8).toBe(0);
				expect(Math.abs(coordinate - 128)).toBeLessThanOrEqual(4);
			}
			expect(pattern.angle).toBeUndefined();
		});

		test('does not load the sprite without labels and patterns', async () => {
			setLayerFeatures(new Map());
			await renderMap(makeJob(makeStyle([{ id: 'bg', type: 'background' }])));
			expect(loadSpriteAtlas).not.toHaveBeenCalled();
		});

		test('renders fill layer with polygons', async () => {
			const polygon = makePolygonFeature([
				[
					[10, 10],
					[100, 10],
					[100, 100],
					[10, 100],
					[10, 10],
				],
			]);
			const features = new Map<string, Features>();
			features.set('land', makeFeatures({ polygons: [polygon] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'fill-layer',
					type: 'fill',
					source: 'src',
					'source-layer': 'land',
					paint: {
						'fill-color': '#00ff00',
						'fill-opacity': 0.8,
					},
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<path');
		});

		test('skips fill layer when no polygons exist', async () => {
			const features = new Map<string, Features>();
			features.set('land', makeFeatures({ polygons: [] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'fill-layer',
					type: 'fill',
					source: 'src',
					'source-layer': 'land',
					paint: { 'fill-color': '#00ff00' },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<path');
		});

		test('skips fill layer when source-layer not found', async () => {
			setLayerFeatures(new Map());

			const style = makeStyle([
				{
					id: 'fill-layer',
					type: 'fill',
					source: 'src',
					'source-layer': 'nonexistent',
					paint: { 'fill-color': '#00ff00' },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<path');
		});

		test('applies filter to fill features', async () => {
			const matchingPolygon = makePolygonFeature(
				[
					[
						[10, 10],
						[100, 10],
						[100, 100],
						[10, 10],
					],
				],
				{ class: 'residential' },
			);
			const nonMatchingPolygon = makePolygonFeature(
				[
					[
						[20, 20],
						[80, 20],
						[80, 80],
						[20, 20],
					],
				],
				{ class: 'commercial' },
			);
			const features = new Map<string, Features>();
			features.set('land', makeFeatures({ polygons: [matchingPolygon, nonMatchingPolygon] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'fill-filtered',
					type: 'fill',
					source: 'src',
					'source-layer': 'land',
					filter: ['==', 'class', 'residential'],
					paint: { 'fill-color': '#00ff00' },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<path');
		});

		test('skips fill layer when all features are filtered out', async () => {
			const polygon = makePolygonFeature(
				[
					[
						[10, 10],
						[100, 10],
						[100, 100],
						[10, 10],
					],
				],
				{ class: 'commercial' },
			);
			const features = new Map<string, Features>();
			features.set('land', makeFeatures({ polygons: [polygon] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'fill-filtered',
					type: 'fill',
					source: 'src',
					'source-layer': 'land',
					filter: ['==', 'class', 'residential'],
					paint: { 'fill-color': '#00ff00' },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<path');
		});
	});

	describe('line layers', () => {
		test('renders line layer with linestrings', async () => {
			const line = makeLineFeature([
				[
					[10, 10],
					[100, 100],
				],
			]);
			const features = new Map<string, Features>();
			features.set('roads', makeFeatures({ linestrings: [line] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'line-layer',
					type: 'line',
					source: 'src',
					'source-layer': 'roads',
					paint: {
						'line-color': '#333333',
						'line-width': 2,
						'line-opacity': 1,
					},
					layout: {
						'line-cap': 'round',
						'line-join': 'round',
					},
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<path');
		});

		test('draws a line with line-gap-width as two lines, one on each side', async () => {
			const road = makeLineFeature(
				[
					[
						[10, 50],
						[200, 50],
					],
				],
				{ gap: 4 },
			);
			const path = makeLineFeature(
				[
					[
						[10, 90],
						[200, 90],
					],
				],
				{ gap: 0 },
			);
			setLayerFeatures(new Map([['roads', makeFeatures({ linestrings: [road, path] })]]));

			const job = makeJob(
				makeStyle([
					{
						id: 'casing',
						type: 'line',
						source: 'src',
						'source-layer': 'roads',
						paint: {
							'line-width': 2,
							'line-offset': 1,
							'line-gap-width': ['get', 'gap'],
						},
					},
				]),
			);
			const drawLineStrings = vi.spyOn(job.renderer, 'drawLineStrings');
			await renderMap(job);

			const drawn: [Feature, LineStyle][] = drawLineStrings.mock.calls[0]![1];
			const [[bands, bandStyle], [drawnPath, pathStyle]] = drawn as [
				[Feature, LineStyle],
				[Feature, LineStyle],
			];
			// Road: one band at 1 ± (4 + 2) / 2 on each side, stroked without caps.
			expect(bands.geometry.map((band) => band.map((p) => [p.x, p.y]))).toEqual([
				[
					[10, 48],
					[200, 48],
				],
				[
					[10, 54],
					[200, 54],
				],
			]);
			expect([bandStyle.offset, bandStyle.width, bandStyle.cap]).toEqual([0, 2, 'butt']);
			// Path: no gap, one line.
			expect(drawnPath).toBe(path);
			expect([pathStyle.offset, pathStyle.width]).toEqual([1, 2]);
		});

		test('draws the features of fill, line and circle layers in sort-key order', async () => {
			const square = (name: string, key: number) =>
				makePolygonFeature(
					[
						[
							[0, 0],
							[10, 0],
							[10, 10],
							[0, 0],
						],
					],
					{ name, key },
				);
			const line = (name: string, key: number) =>
				makeLineFeature(
					[
						[
							[0, 0],
							[10, 10],
						],
					],
					{ name, key },
				);
			const point = (name: string, key: number) => makePointFeature([[[5, 5]]], { name, key });
			setLayerFeatures(
				new Map([
					[
						'l',
						makeFeatures({
							polygons: [square('a', 3), square('b', 1), square('c', 2)],
							linestrings: [line('a', 3), line('b', 1), line('c', 2)],
							points: [point('a', 3), point('b', 1), point('c', 2)],
						}),
					],
				]),
			);
			const key = ['get', 'key'] as ['get', string];
			const job = makeJob(
				makeStyle([
					{
						id: 'f',
						type: 'fill',
						source: 'src',
						'source-layer': 'l',
						layout: { 'fill-sort-key': key },
					},
					{
						id: 'l',
						type: 'line',
						source: 'src',
						'source-layer': 'l',
						layout: { 'line-sort-key': key },
					},
					{
						id: 'c',
						type: 'circle',
						source: 'src',
						'source-layer': 'l',
						layout: { 'circle-sort-key': key },
					},
				]),
			);
			const spies = [
				vi.spyOn(job.renderer, 'drawPolygons'),
				vi.spyOn(job.renderer, 'drawLineStrings'),
				vi.spyOn(job.renderer, 'drawCircles'),
			];
			await renderMap(job);
			for (const spy of spies) {
				const drawn = spy.mock.calls[0]![1] as [Feature, unknown][];
				// The fill layer draws the linestrings too (fillable); only the polygons count here.
				const ordered = drawn
					.map(([f]) => f)
					.filter((f) => f.type !== 'LineString' || spy !== spies[0]);
				expect(ordered.map((f) => f.properties.name)).toEqual(['b', 'c', 'a']);
			}
		});

		test('skips line layer when no linestrings exist', async () => {
			const features = new Map<string, Features>();
			features.set('roads', makeFeatures({ linestrings: [] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'line-layer',
					type: 'line',
					source: 'src',
					'source-layer': 'roads',
					paint: { 'line-color': '#333333', 'line-width': 2 },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('stroke=');
		});

		test('applies filter to line features', async () => {
			const matchingLine = makeLineFeature(
				[
					[
						[10, 10],
						[100, 100],
					],
				],
				{ class: 'highway' },
			);
			const nonMatchingLine = makeLineFeature(
				[
					[
						[20, 20],
						[80, 80],
					],
				],
				{ class: 'path' },
			);
			const features = new Map<string, Features>();
			features.set('roads', makeFeatures({ linestrings: [matchingLine, nonMatchingLine] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'line-filtered',
					type: 'line',
					source: 'src',
					'source-layer': 'roads',
					filter: ['==', 'class', 'highway'],
					paint: { 'line-color': '#333333', 'line-width': 2 },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<path');
		});

		test('skips line layer when all features are filtered out', async () => {
			const line = makeLineFeature(
				[
					[
						[10, 10],
						[100, 100],
					],
				],
				{ class: 'path' },
			);
			const features = new Map<string, Features>();
			features.set('roads', makeFeatures({ linestrings: [line] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'line-filtered',
					type: 'line',
					source: 'src',
					'source-layer': 'roads',
					filter: ['==', 'class', 'highway'],
					paint: { 'line-color': '#333333', 'line-width': 2 },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('stroke=');
		});
	});

	describe('circle layers', () => {
		test('renders circle layer with points', async () => {
			const point = makePointFeature([[[50, 50]]]);
			const features = new Map<string, Features>();
			features.set('pois', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'circle-layer',
					type: 'circle',
					source: 'src',
					'source-layer': 'pois',
					paint: {
						'circle-color': '#ff0000',
						'circle-radius': 5,
						'circle-opacity': 1,
					},
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<circle');
		});

		test('draws circles at the vertices of lines, but places no labels there', async () => {
			const vertices = makePointFeature([[[40, 40]], [[80, 80]]], { name: 'Road' });
			setLayerFeatures(new Map([['roads', { ...makeFeatures(), vertices: [vertices] }]]));

			const job = makeJob(
				makeStyle([
					{
						id: 'dots',
						type: 'circle',
						source: 'src',
						'source-layer': 'roads',
						paint: { 'circle-radius': 3 },
					},
					{
						id: 'names',
						type: 'symbol',
						source: 'src',
						'source-layer': 'roads',
						layout: { 'text-field': '{name}' },
					},
				]),
				10,
				{ renderLabels: true },
			);
			const drawCircles = vi.spyOn(job.renderer, 'drawCircles');
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);

			expect(drawCircles.mock.calls[0]![1].map(([feature]) => feature)).toEqual([vertices]);
			expect(drawLabels.mock.calls.flatMap(([, labels]) => labels)).toEqual([]);
		});

		test('skips circle layer when no points exist', async () => {
			const features = new Map<string, Features>();
			features.set('pois', makeFeatures({ points: [] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'circle-layer',
					type: 'circle',
					source: 'src',
					'source-layer': 'pois',
					paint: { 'circle-color': '#ff0000', 'circle-radius': 5 },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<circle');
		});

		test('applies filter to circle features', async () => {
			const matchingPoint = makePointFeature([[[50, 50]]], { type: 'cafe' });
			const nonMatchingPoint = makePointFeature([[[80, 80]]], { type: 'bank' });
			const features = new Map<string, Features>();
			features.set('pois', makeFeatures({ points: [matchingPoint, nonMatchingPoint] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'circle-filtered',
					type: 'circle',
					source: 'src',
					'source-layer': 'pois',
					filter: ['==', 'type', 'cafe'],
					paint: { 'circle-color': '#ff0000', 'circle-radius': 5 },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<circle');
		});

		test('skips circle layer when all features are filtered out', async () => {
			const point = makePointFeature([[[50, 50]]], { type: 'bank' });
			const features = new Map<string, Features>();
			features.set('pois', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'circle-filtered',
					type: 'circle',
					source: 'src',
					'source-layer': 'pois',
					filter: ['==', 'type', 'cafe'],
					paint: { 'circle-color': '#ff0000', 'circle-radius': 5 },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<circle');
		});
	});

	describe('symbol layers', () => {
		test('turns map-aligned translations, labels and patterns with the bearing', async () => {
			const sprite = {
				width: 16,
				height: 16,
				x: 0,
				y: 0,
				pixelRatio: 2,
				sdf: false,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 16,
				sheetHeight: 16,
			};
			(loadSpriteAtlas as Mock).mockResolvedValue(new Map([['hatch', sprite]]));
			const place = makePointFeature([[[128, 128]]], { name: 'X' });
			const square = makePolygonFeature([
				[
					[0, 0],
					[50, 0],
					[50, 50],
					[0, 0],
				],
			]);
			setLayerFeatures(new Map([['l', makeFeatures({ points: [place], polygons: [square] })]]));
			const job = {
				...makeJob(
					makeStyle([
						{
							id: 'fill',
							type: 'fill',
							source: 'src',
							'source-layer': 'l',
							paint: { 'fill-pattern': 'hatch', 'fill-translate': [10, 0] },
						},
						{
							id: 'viewport',
							type: 'fill',
							source: 'src',
							'source-layer': 'l',
							paint: { 'fill-translate': [10, 0], 'fill-translate-anchor': 'viewport' },
						},
						{
							id: 'labels',
							type: 'symbol',
							source: 'src',
							'source-layer': 'l',
							layout: { 'text-field': '{name}', 'text-rotation-alignment': 'map' },
						},
					]),
					10,
					{ renderLabels: true },
				),
				view: { center: [0, 0] as [number, number], zoom: 10, bearing: 90 },
			};
			const drawPolygons = vi.spyOn(job.renderer, 'drawPolygons');
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);

			const [patterned, viewport] = drawPolygons.mock.calls.map(([, f]) => f[0]![1]);
			// East (10, 0) on a map turned by 90° is up: (0, -10). On the viewport, it stays.
			expect(patterned!.translate.map((v) => Math.round(v))).toEqual([0, -10]);
			expect(viewport!.translate).toEqual([10, 0]);
			expect(patterned!.pattern!.angle).toBe(-90);
			expect(drawLabels.mock.calls[0]![1][0]![1].rotate).toBe(-90);
		});

		test('moves labels by text-translate, together with the area they block', async () => {
			const points = [
				makePointFeature([[[100, 100]]], { name: 'moved' }),
				makePointFeature([[[200, 30]]], { name: 'free' }),
				makePointFeature([[[100, 160]]], { name: 'blocked' }),
			];
			setLayerFeatures(new Map([['places', makeFeatures({ points })]]));
			const layer = (id: string, names: string[], translate: [number, number]) => ({
				id,
				type: 'symbol' as const,
				source: 'src',
				'source-layer': 'places',
				filter: ['in', ['get', 'name'], ['literal', names]] as never,
				layout: { 'text-field': '{name}' },
				paint: { 'text-translate': translate },
			});
			const job = makeJob(
				makeStyle([
					layer('lower', ['moved', 'free'], [0, 60]),
					layer('upper', ['blocked'], [0, 0]),
				]),
				10,
				{ renderLabels: true },
			);
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);
			const drawn = new Map(drawLabels.mock.calls.map(([id, labels]) => [id, labels]));
			// "moved" is moved onto "blocked", placed before it by the upper layer: it is dropped.
			expect(drawn.get('upper-labels')!.map(([, style]) => style.text)).toEqual(['blocked']);
			const lower = drawn.get('lower-labels')!;
			expect(lower.map(([, style]) => style.text)).toEqual(['free']);
			expect(lower[0]![0].geometry[0]![0]).toEqual(expect.objectContaining({ x: 200, y: 90 }));
		});

		test('breaks a long point label into lines, but not one along a line', async () => {
			const name = 'Friedrich-Wilhelm-Universität zu Berlin';
			const point = makePointFeature([[[128, 128]]], { name });
			const street = makeLineFeature(
				[
					[
						[0, 20],
						[256, 20],
					],
				],
				{ name: 'Unter den Linden' },
			);
			setLayerFeatures(new Map([['l', makeFeatures({ points: [point], linestrings: [street] })]]));
			const job = makeJob(
				makeStyle([
					{
						id: 'streets',
						type: 'symbol',
						source: 'src',
						'source-layer': 'l',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'text-field': '{name}', 'symbol-placement': 'line', 'text-max-width': 3 },
					},
					{
						id: 'places',
						type: 'symbol',
						source: 'src',
						'source-layer': 'l',
						filter: ['==', ['geometry-type'], 'Point'],
						layout: { 'text-field': '{name}' },
					},
				]),
				10,
				{ renderLabels: true },
			);
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);
			const [place] = drawLabels.mock.calls.find(([id]) => id === 'places-labels')![1];
			expect(place![1].lines!.map((l) => l.text)).toEqual([
				'Friedrich-Wilhelm-',
				'Universität zu Berlin',
			]);
			const [street0] = drawLabels.mock.calls.find(([id]) => id === 'streets-labels')![1];
			expect(street0![1].lines).toBeUndefined();
			expect(street0![1].path!.map((g) => g.text).join('')).toBe('Unter den Linden');
		});

		test('places labels and icons along lines, repeated and turned with the line', async () => {
			// A long street running down the image at 45°.
			const street = makeLineFeature(
				[
					[
						[0, 0],
						[600, 600],
					],
				],
				{ name: 'Main', oneway: true },
			);
			setLayerFeatures(new Map([['streets', makeFeatures({ linestrings: [street] })]]));
			const arrow = {
				width: 20,
				height: 10,
				x: 0,
				y: 0,
				pixelRatio: 1,
				sdf: false,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 20,
				sheetHeight: 10,
			};
			(loadSpriteAtlas as Mock).mockResolvedValue(new Map([['arrow', arrow]]));
			const job = makeJob(
				makeStyle([
					// The arrows lie below the names, as in the VersaTiles styles.
					{
						id: 'oneway',
						type: 'symbol',
						source: 'src',
						'source-layer': 'streets',
						layout: {
							'icon-image': 'arrow',
							'symbol-placement': 'line',
							'symbol-spacing': 100,
							'icon-rotation-alignment': 'map',
						},
					},
					{
						id: 'names',
						type: 'symbol',
						source: 'src',
						'source-layer': 'streets',
						layout: { 'text-field': '{name}', 'symbol-placement': 'line' },
					},
				]),
				10,
				{ renderLabels: true },
			);
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			const drawIcons = vi.spyOn(job.renderer, 'drawIcons');
			await renderMap(job);

			const labels = drawLabels.mock.calls.find(([id]) => id === 'names-labels')![1];
			// ~849 px of line, 250 px spacing: several labels, each glyph turned by 45°.
			expect(labels.length).toBeGreaterThan(1);
			for (const [, style] of labels) {
				expect(style.path!.map((g) => g.text).join('')).toBe('Main');
				for (const glyph of style.path!) expect(glyph.angle).toBeCloseTo(45);
			}
			const icons = drawIcons.mock.calls.find(([id]) => id === 'oneway-icons')![1];
			expect(icons.length).toBeGreaterThan(labels.length);
			for (const [, style] of icons) expect(style.rotate).toBeCloseTo(45);
		});

		test('drops labels that overlap one placed before, the upper layer first', async () => {
			// Three labels at the same spot in two layers, and one elsewhere.
			const points = [
				makePointFeature([[[100, 100]]], { name: 'lower' }),
				makePointFeature([[[100, 100]]], { name: 'upper-1' }),
				makePointFeature([[[102, 101]]], { name: 'upper-2' }),
				makePointFeature([[[100, 200]]], { name: 'apart' }),
			];
			setLayerFeatures(new Map([['places', makeFeatures({ points })]]));
			const layer = (id: string, filter: string[]) => ({
				id,
				type: 'symbol' as const,
				source: 'src',
				'source-layer': 'places',
				filter: ['in', ['get', 'name'], ['literal', filter]] as never,
				layout: { 'text-field': '{name}' },
			});
			const job = makeJob(
				makeStyle([layer('lower', ['lower', 'apart']), layer('upper', ['upper-1', 'upper-2'])]),
				10,
				{ renderLabels: true },
			);
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);
			const drawn = drawLabels.mock.calls.map(([id, labels]) => [
				id,
				labels.map(([, s]) => s.text),
			]);
			expect(drawn).toEqual([
				['lower-labels', ['apart']],
				['upper-labels', ['upper-1']],
			]);
		});

		test('applies text-transform and symbol-sort-key', async () => {
			const points = ['b', 'a'].map((name, i) =>
				makePointFeature([[[10 + i * 50, 10]]], { name, rank: name === 'a' ? 1 : 2 }),
			);
			setLayerFeatures(new Map([['places', makeFeatures({ points })]]));
			const job = makeJob(
				makeStyle([
					{
						id: 'labels',
						type: 'symbol',
						source: 'src',
						'source-layer': 'places',
						layout: {
							'text-field': '{name}',
							'text-transform': 'uppercase',
							'symbol-sort-key': ['get', 'rank'],
						},
					},
				]),
				10,
				{ renderLabels: true },
			);
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);
			expect(drawLabels.mock.calls[0]![1].map(([, style]) => style.text)).toEqual(['A', 'B']);
		});

		test("places a polygon's label inside each of its polygons, styled as a polygon", async () => {
			const park = makePolygonFeature(
				[
					[
						[0, 0],
						[100, 0],
						[100, 100],
						[0, 100],
						[0, 0],
					],
					[
						[200, 0],
						[240, 0],
						[240, 40],
						[200, 40],
						[200, 0],
					],
				],
				{ name: 'Park' },
			);
			setLayerFeatures(new Map([['parks', makeFeatures({ polygons: [park] })]]));
			const job = makeJob(
				makeStyle([
					{
						id: 'labels',
						type: 'symbol',
						source: 'src',
						'source-layer': 'parks',
						layout: {
							'text-field': '{name}',
							'text-size': ['match', ['geometry-type'], 'Polygon', 20, 10],
						},
					},
				]),
				10,
				{ renderLabels: true },
			);
			const drawLabels = vi.spyOn(job.renderer, 'drawLabels');
			await renderMap(job);

			const drawn = drawLabels.mock.calls[0]![1].map(([feature, style]) => {
				const point = feature.geometry[0]![0]!;
				return [Math.round(point.x), Math.round(point.y), style.size];
			});
			expect(drawn).toEqual([
				[50, 50, 20],
				[220, 20, 20],
			]);
		});

		test('renders symbol layer with text-field', async () => {
			const point = makePointFeature([[[50, 50]]], { name: 'Berlin' });
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'label-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: {
						'text-field': '{name}',
						'text-size': 14,
					},
					paint: {
						'text-color': '#333333',
					},
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).toContain('<text');
			expect(result).toContain('Berlin');
		});

		test('skips symbol layer when renderLabels is false', async () => {
			const point = makePointFeature([[[50, 50]]], { name: 'Berlin' });
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'label-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: { 'text-field': '{name}' },
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<text');
		});

		test('skips symbol layer when no features exist', async () => {
			setLayerFeatures(new Map());

			const style = makeStyle([
				{
					id: 'label-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: { 'text-field': '{name}' },
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).not.toContain('<text');
		});

		test('skips features without text-field value', async () => {
			const point = makePointFeature([[[50, 50]]], {});
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'label-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: {
						'text-field': '{name}',
					},
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).not.toContain('<text');
		});

		test('applies filter to symbol features', async () => {
			const matching = makePointFeature([[[50, 50]]], { name: 'Berlin', class: 'city' });
			const nonMatching = makePointFeature([[[80, 80]]], { name: 'Park', class: 'poi' });
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [matching, nonMatching] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'label-filtered',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					filter: ['==', 'class', 'city'],
					layout: { 'text-field': '{name}' },
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).toContain('Berlin');
			expect(result).not.toContain('Park');
		});

		test('renders symbols from linestring features', async () => {
			const line = makeLineFeature(
				[
					[
						[10, 10],
						[100, 100],
					],
				],
				{ name: 'Main St' },
			);
			const features = new Map<string, Features>();
			features.set('roads', makeFeatures({ linestrings: [line] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'road-label',
					type: 'symbol',
					source: 'src',
					'source-layer': 'roads',
					layout: { 'text-field': '{name}' },
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).toContain('<text');
			expect(result).toContain('Main St');
		});

		test('renders icons from sprite atlas', async () => {
			const point = makePointFeature([[[50, 50]]], { name: 'Berlin' });
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const spriteAtlas = new Map();
			spriteAtlas.set('city-icon', {
				x: 0,
				y: 0,
				width: 24,
				height: 24,
				pixelRatio: 1,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 256,
				sheetHeight: 256,
			});
			(loadSpriteAtlas as Mock).mockResolvedValue(spriteAtlas);

			const style = makeStyle([
				{
					id: 'icon-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: {
						'icon-image': 'city-icon',
					},
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).toContain('<image');
			expect(result).toContain('data:image/png;base64,AAAA');
		});

		test('skips icons when sprite is not found', async () => {
			const point = makePointFeature([[[50, 50]]], {});
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const style = makeStyle([
				{
					id: 'icon-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: {
						'icon-image': 'nonexistent',
					},
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).not.toContain('<image');
		});

		test('renders both icons and text on same symbol layer', async () => {
			const point = makePointFeature([[[50, 50]]], { name: 'Berlin' });
			const features = new Map<string, Features>();
			features.set('places', makeFeatures({ points: [point] }));
			setLayerFeatures(features);

			const spriteAtlas = new Map();
			spriteAtlas.set('city-icon', {
				x: 0,
				y: 0,
				width: 24,
				height: 24,
				pixelRatio: 1,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 256,
				sheetHeight: 256,
			});
			(loadSpriteAtlas as Mock).mockResolvedValue(spriteAtlas);

			const style = makeStyle([
				{
					id: 'icon-text-layer',
					type: 'symbol',
					source: 'src',
					'source-layer': 'places',
					layout: {
						'icon-image': 'city-icon',
						'text-field': '{name}',
					},
				},
			]);
			const result = await renderMap(makeJob(style, 10, { renderLabels: true }));
			expect(result).toContain('<image');
			expect(result).toContain('<text');
			expect(result).toContain('Berlin');
		});

		test('fits an icon to its label with icon-text-fit and icon-text-fit-padding', async () => {
			const point = makePointFeature([[[50, 50]]], { name: 'Berlin' });
			setLayerFeatures(new Map([['places', makeFeatures({ points: [point] })]]));
			const spriteAtlas = new Map();
			spriteAtlas.set('shield', {
				x: 0,
				y: 0,
				width: 24,
				height: 24,
				pixelRatio: 1,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 256,
				sheetHeight: 256,
			});
			(loadSpriteAtlas as Mock).mockResolvedValue(spriteAtlas);

			const job = makeJob(
				makeStyle([
					{
						id: 'shields',
						type: 'symbol',
						source: 'src',
						'source-layer': 'places',
						layout: {
							'icon-image': 'shield',
							'text-field': '{name}',
							'text-size': 10,
							'icon-text-fit': 'both',
							'icon-text-fit-padding': [2, 4, 2, 4],
						},
					},
				]),
				10,
				{ renderLabels: true },
			);
			const drawIcons = vi.spyOn(job.renderer, 'drawIcons');
			await renderMap(job);

			const icons = drawIcons.mock.calls.find(([id]) => id === 'shields-icons')![1];
			const style: IconStyle = icons[0]![1];
			// The label's box, one line of 10 × 1.2 pixels, plus the padding.
			const [left, top, right, bottom] = style.fit!;
			expect([top, bottom]).toEqual([-8, 8]);
			expect(left).toBeCloseTo(-right);
			expect(right - left).toBeGreaterThan(30);
		});
	});

	describe('raster layers', () => {
		test('renders raster layer with tiles', async () => {
			(getRasterTiles as Mock).mockResolvedValue([
				{
					x: 0,
					y: 0,
					width: 256,
					height: 256,
					dataUri: 'data:image/png;base64,abc',
				},
			]);

			const style = makeStyle([
				{
					id: 'raster-layer',
					type: 'raster',
					source: 'satellite',
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).toContain('<image');
		});

		test('renders raster layer with empty tiles', async () => {
			(getRasterTiles as Mock).mockResolvedValue([]);

			const style = makeStyle([
				{
					id: 'raster-layer',
					type: 'raster',
					source: 'satellite',
				},
			]);
			const result = await renderMap(makeJob(style));
			expect(result).not.toContain('<image');
		});
	});

	describe('feature lookup', () => {
		const square = (): Feature =>
			makePolygonFeature([
				[
					[10, 10],
					[100, 10],
					[100, 100],
					[10, 10],
				],
			]);
		const fillLayer = (source: string, sourceLayer?: string) => ({
			id: `fill-${source}`,
			type: 'fill' as const,
			source,
			...(sourceLayer === undefined ? {} : { 'source-layer': sourceLayer }),
			paint: { 'fill-color': '#00ff00' },
		});

		test('draws a GeoJSON source, ignoring source-layer', async () => {
			setSourceFeatures(
				new Map([['geo', new Map([[GEOJSON_LAYER, makeFeatures({ polygons: [square()] })]])]]),
			);
			const result = await renderMap(makeJob(makeStyle([fillLayer('geo', 'nonexistent')])));
			expect(result).toContain('<path');
		});

		test("takes features only from the layer's own source", async () => {
			// Both sources have a layer "water"; only source "b" has features in it.
			setSourceFeatures(
				new Map([
					['a', new Map([['water', makeFeatures()]])],
					['b', new Map([['water', makeFeatures({ polygons: [square()] })]])],
				]),
			);
			expect(await renderMap(makeJob(makeStyle([fillLayer('a', 'water')])))).not.toContain('<path');
			expect(await renderMap(makeJob(makeStyle([fillLayer('b', 'water')])))).toContain('<path');
		});

		test('does not mix a GeoJSON source into a vector layer of the same name', async () => {
			setSourceFeatures(
				new Map([
					['vec', new Map([['water', makeFeatures()]])],
					['water', new Map([[GEOJSON_LAYER, makeFeatures({ polygons: [square()] })]])],
				]),
			);
			expect(await renderMap(makeJob(makeStyle([fillLayer('vec', 'water')])))).not.toContain(
				'<path',
			);
			expect(await renderMap(makeJob(makeStyle([fillLayer('water')])))).toContain('<path');
		});
	});

	describe('error handling', () => {
		test('throws on unknown layer type', async () => {
			const style = makeStyle([
				{
					id: 'unknown',
					type: 'custom-type',
				} as unknown as StyleSpecification['layers'][number],
			]);
			await expect(renderMap(makeJob(style))).rejects.toThrow('layerStyle.type');
		});
	});

	describe('other skipped layer types', () => {
		const skippedTypes = ['fill-extrusion', 'heatmap', 'hillshade'] as const;

		for (const type of skippedTypes) {
			test(`skips ${type} layer`, async () => {
				const style = makeStyle([
					{
						id: `${type}-layer`,
						type,
						source: 'src',
						'source-layer': 'data',
					},
				]);
				const result = await renderMap(makeJob(style));
				expect(result).toContain('<svg');
			});
		}
	});

	describe('promoteId', () => {
		/** A square with the tile id 7, and the property `ref`. */
		function square(ref: unknown): Feature {
			return new Feature({
				type: 'Polygon',
				id: 7,
				properties: { ref },
				geometry: [
					[new Point2D(10, 10), new Point2D(50, 10), new Point2D(50, 50), new Point2D(10, 10)],
				],
			});
		}

		async function drawnIds(promoteId: unknown, ref: unknown): Promise<unknown[]> {
			setLayerFeatures(new Map([['sites', makeFeatures({ polygons: [square(ref)] })]]));
			const style = makeStyle([
				{
					id: 'sites',
					type: 'fill',
					source: 'src',
					'source-layer': 'sites',
					// Filters read the tile's id.
					filter: ['==', ['id'], 7],
					// The id as the color's alpha channel, so it can be read back.
					paint: {
						'fill-color': ['to-color', ['concat', 'hsla(0,0%,0%,', ['to-string', ['id']], ')']],
					},
				},
			]);
			style.sources = { src: { type: 'vector', tiles: [], promoteId } as never };
			const job = makeJob(style);
			const drawPolygons = vi.spyOn(job.renderer, 'drawPolygons');
			await renderMap(job);
			return (drawPolygons.mock.calls[0]?.[1] ?? []).map(([, fill]) => fill.color.a);
		}

		test('gives paint properties the promoted property, and filters the tile id', async () => {
			expect(await drawnIds('ref', 0.25)).toEqual([0.25]);
			expect(await drawnIds({ sites: 'ref' }, 0.5)).toEqual([0.5]);
			// A boolean becomes a number.
			expect(await drawnIds('ref', true)).toEqual([1]);
		});

		test('leaves the tile id to paint properties without promoteId', async () => {
			// hsla(0,0%,0%,7) is clamped to opaque.
			expect(await drawnIds(undefined, 0.25)).toEqual([1]);
		});
	});

	describe('patterns at a fractional zoom level', () => {
		const sprite = {
			width: 16,
			height: 16,
			x: 0,
			y: 0,
			pixelRatio: 2,
			sdf: false,
			sheetDataUri: 'data:image/png;base64,AAAA',
			sheetWidth: 16,
			sheetHeight: 16,
		};

		beforeEach(() => {
			(loadSpriteAtlas as Mock).mockResolvedValue(new Map([['base:hatch', sprite]]));
		});

		test('repeat a line pattern as MapLibre does, and leave out a missing image', async () => {
			const line = (pattern: string): Feature =>
				makeLineFeature(
					[
						[
							[0, 10],
							[100, 10],
						],
					],
					{ pattern },
				);
			setLayerFeatures(
				new Map([['roads', makeFeatures({ linestrings: [line('base:hatch'), line('missing')] })]]),
			);
			const job = makeJob(
				makeStyle([
					{
						id: 'roads',
						type: 'line',
						source: 'src',
						'source-layer': 'roads',
						paint: {
							'line-pattern': ['get', 'pattern'],
							'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 12, 24],
						},
					},
				]),
				10.5,
			);
			const drawLineStrings = vi.spyOn(job.renderer, 'drawLineStrings');
			await renderMap(job);

			const drawn = drawLineStrings.mock.calls[0]![1];
			expect(drawn).toHaveLength(1);
			const [, style] = drawn[0]!;
			expect(style.width).toBe(12);
			// The 8 × 8 px image, scaled to the width at zoom 10 (8 px), then with the map by √2.
			expect(style.pattern!.name).toBe('base:hatch');
			expect(style.pattern!.period).toBeCloseTo(8 * Math.SQRT2, 9);
		});

		test('scale a fill pattern with the map from the zoom level’s integer part', async () => {
			setLayerFeatures(
				new Map([
					[
						'sites',
						makeFeatures({
							polygons: [
								makePolygonFeature([
									[
										[0, 0],
										[50, 0],
										[50, 50],
										[0, 0],
									],
								]),
							],
						}),
					],
				]),
			);
			const job = makeJob(
				makeStyle([
					{
						id: 'sites',
						type: 'fill',
						source: 'src',
						'source-layer': 'sites',
						paint: { 'fill-pattern': 'base:hatch' },
					},
				]),
				10.5,
			);
			const drawPolygons = vi.spyOn(job.renderer, 'drawPolygons');
			await renderMap(job);
			expect(drawPolygons.mock.calls[0]![1][0]![1].pattern!.scale).toBeCloseTo(Math.SQRT2, 9);
		});
	});
});
