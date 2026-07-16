import { describe, expect, test } from 'vitest';
import { SVGRenderer } from './svg.js';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { Feature, Point2D } from '../geometry.js';
import type {
	CircleStyle,
	IconStyle,
	LineStyle,
	RasterStyle,
	RasterTile,
	SymbolStyle,
} from './svg.js';
import type { SpriteAtlas } from '../sources/sprite.js';

function mc(hex: string, alpha = 1): Color {
	const r = (parseInt(hex.slice(1, 3), 16) / 255) * alpha;
	const g = (parseInt(hex.slice(3, 5), 16) / 255) * alpha;
	const b = (parseInt(hex.slice(5, 7), 16) / 255) * alpha;
	return new Color(r, g, b, alpha);
}

function makeRenderer(): SVGRenderer {
	return new SVGRenderer({ width: 256, height: 256 });
}

function makePolygonFeature(points: [number, number][][]): Feature {
	return new Feature({
		type: 'Polygon',
		properties: {},
		geometry: points.map((ring) => ring.map(([x, y]) => new Point2D(x, y))),
	});
}

function makeLineFeature(points: [number, number][][]): Feature {
	return new Feature({
		type: 'LineString',
		properties: {},
		geometry: points.map((line) => line.map(([x, y]) => new Point2D(x, y))),
	});
}

describe('SVGRenderer', () => {
	describe('getString', () => {
		test('produces valid SVG wrapper', () => {
			const r = makeRenderer();
			const svg = r.getString();
			expect(svg).toContain('<svg');
			expect(svg).toContain('viewBox="0 0 256 256"');
			expect(svg).toContain('width="256"');
			expect(svg).toContain('height="256"');
			expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
			expect(svg).toContain('</svg>');
		});

		test('includes clipPath and clip group', () => {
			const r = makeRenderer();
			const svg = r.getString();
			expect(svg).toContain('<clipPath id="vb"><rect width="256" height="256"/></clipPath>');
			expect(svg).toContain('<g id="map" clip-path="url(#vb)">');
		});

		test('default background has no rect', () => {
			const r = makeRenderer();
			const svg = r.getString();
			expect(svg).not.toMatch(/<rect[^/]*fill/);
		});
	});

	describe('drawBackgroundFill', () => {
		test('sets background color as oversized rect', () => {
			const r = makeRenderer();
			r.drawBackgroundFill({ color: mc('#FF0000'), opacity: 1 });
			const svg = r.getString();
			expect(svg).toContain('<rect x="-1" y="-1" width="258" height="258" fill="#FF0000" />');
		});

		test('applies opacity to alpha', () => {
			const r = makeRenderer();
			r.drawBackgroundFill({ color: mc('#FF0000'), opacity: 0.5 });
			const svg = r.getString();
			expect(svg).toContain(
				'<rect x="-1" y="-1" width="258" height="258" fill="#FF0000" fill-opacity="0.502" />',
			);
		});
	});

	describe('drawPolygons', () => {
		test('generates path elements', () => {
			const r = makeRenderer();
			const feature = makePolygonFeature([
				[
					[0, 0],
					[10, 0],
					[10, 10],
					[0, 10],
				],
			]);
			const style = { color: mc('#336699'), opacity: 1, translate: [0, 0] as [number, number] };
			r.drawPolygons('fill-test', [[feature, style]]);
			const svg = r.getString();
			expect(svg).toContain('<g id="fill-test">');
			expect(svg).toContain('<path d=');
			expect(svg).toContain('fill="#336699"');
		});

		test('empty features produce no output', () => {
			const r = makeRenderer();
			r.drawPolygons('fill-test', []);
			const svg = r.getString();
			expect(svg).not.toContain('<path');
		});

		test('zero opacity produces no output', () => {
			const r = makeRenderer();
			const feature = makePolygonFeature([
				[
					[0, 0],
					[10, 0],
					[10, 10],
				],
			]);
			const style = { color: mc('#336699'), opacity: 0, translate: [0, 0] as [number, number] };
			r.drawPolygons('fill-test', [[feature, style]]);
			const svg = r.getString();
			expect(svg).not.toContain('<path');
		});

		test('transparent fill color produces no path', () => {
			const r = makeRenderer();
			const feature = makePolygonFeature([
				[
					[0, 0],
					[10, 0],
					[10, 10],
				],
			]);
			const style = {
				color: new Color(0, 0, 0, 0),
				opacity: 1,
				translate: [0, 0] as [number, number],
			};
			r.drawPolygons('fill-test', [[feature, style]]);
			const svg = r.getString();
			expect(svg).not.toContain('<path');
		});

		test('merges only consecutive same-attribute features, preserving draw order', () => {
			const r = makeRenderer();
			const poly = (): Feature =>
				makePolygonFeature([
					[
						[0, 0],
						[10, 0],
						[10, 10],
					],
				]);
			const fill = (
				hex: string,
			): { color: Color; opacity: number; translate: [number, number] } => ({
				color: mc(hex),
				opacity: 1,
				translate: [0, 0],
			});
			// Order: red, red, blue, red. Global merging would emit red(×3) then blue,
			// changing the paint order; run-length keeps red-red, blue, red.
			r.drawPolygons('fill-test', [
				[poly(), fill('#FF0000')],
				[poly(), fill('#FF0000')],
				[poly(), fill('#0000FF')],
				[poly(), fill('#FF0000')],
			]);
			const svg = r.getString();
			const fills = [...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
			expect(fills).toEqual(['#FF0000', '#0000FF', '#FF0000']);
		});
	});

	describe('drawLineStrings', () => {
		test('generates path elements with stroke attributes', () => {
			const r = makeRenderer();
			const feature = makeLineFeature([
				[
					[0, 0],
					[50, 50],
				],
			]);
			const style = {
				blur: 0,
				cap: 'round' as const,
				color: mc('#FF0000'),
				join: 'round' as const,
				miterLimit: 2,
				offset: 0,
				opacity: 1,
				translate: [0, 0] as [number, number],
				width: 2,
			};
			r.drawLineStrings('line-test', [[feature, style]]);
			const svg = r.getString();
			expect(svg).toContain('<g id="line-test">');
			expect(svg).toContain('<path d=');
			expect(svg).toContain('fill="none"');
			expect(svg).toContain('stroke="#FF0000"');
			expect(svg).toContain('stroke-linecap="round"');
			expect(svg).toContain('stroke-linejoin="round"');
		});

		test('empty features produce no output', () => {
			const r = makeRenderer();
			r.drawLineStrings('line-test', []);
			const svg = r.getString();
			expect(svg).not.toContain('<path');
		});

		test('zero opacity produces no output', () => {
			const r = makeRenderer();
			const feature = makeLineFeature([
				[
					[0, 0],
					[10, 10],
				],
			]);
			const style = {
				blur: 0,
				cap: 'butt' as const,
				color: mc('#FF0000'),
				join: 'miter' as const,
				miterLimit: 2,
				offset: 0,
				opacity: 0,
				translate: [0, 0] as [number, number],
				width: 1,
			};
			r.drawLineStrings('line-test', [[feature, style]]);
			const svg = r.getString();
			expect(svg).not.toContain('<path');
		});

		test('zero width produces no path', () => {
			const r = makeRenderer();
			const feature = makeLineFeature([
				[
					[0, 0],
					[10, 10],
				],
			]);
			const style = {
				blur: 0,
				cap: 'butt' as const,
				color: mc('#FF0000'),
				join: 'miter' as const,
				miterLimit: 2,
				offset: 0,
				opacity: 1,
				translate: [0, 0] as [number, number],
				width: 0,
			};
			r.drawLineStrings('line-test', [[feature, style]]);
			const svg = r.getString();
			expect(svg).not.toContain('<path');
		});

		function lineStyle(overrides: Partial<LineStyle> = {}): LineStyle {
			return {
				blur: 0,
				cap: 'butt',
				color: mc('#FF0000'),
				join: 'miter',
				miterLimit: 2,
				offset: 0,
				opacity: 1,
				translate: [0, 0],
				width: 2,
				...overrides,
			};
		}

		test('positive line-offset shifts an eastward line to the right (screen +y)', () => {
			const r = makeRenderer();
			// Eastward line at y=50. MapLibre: positive offset => right of travel => +y (down).
			const feature = makeLineFeature([
				[
					[0, 50],
					[100, 50],
				],
			]);
			r.drawLineStrings('line-test', [[feature, lineStyle({ offset: 10 })]]);
			const svg = r.getString();
			expect(svg).toContain(',60'); // shifted down to y=60
			expect(svg).not.toContain(',40');
		});

		test('negative line-offset shifts an eastward line to the left (screen -y)', () => {
			const r = makeRenderer();
			const feature = makeLineFeature([
				[
					[0, 50],
					[100, 50],
				],
			]);
			r.drawLineStrings('line-test', [[feature, lineStyle({ offset: -10 })]]);
			const svg = r.getString();
			expect(svg).toContain(',40'); // shifted up to y=40
			expect(svg).not.toContain(',60');
		});

		test('emits an feGaussianBlur filter for line-blur', () => {
			const r = makeRenderer();
			const feature = makeLineFeature([
				[
					[0, 50],
					[100, 50],
				],
			]);
			// width 2, blur 3
			r.drawLineStrings('line-test', [[feature, lineStyle({ blur: 3 })]]);
			const svg = r.getString();
			expect(svg).toContain('feGaussianBlur');
			expect(svg).toContain('stdDeviation="0.5"'); // blur 3 * stdFactor 0.15 = 0.45
			// userSpaceOnUse region so axis-aligned lines aren't clipped away
			expect(svg).toContain('filterUnits="userSpaceOnUse"');
			expect(svg).toContain('filter="url(#line-blur-0)"');
			// alpha is steepened to clip the Gaussian tails toward MapLibre's hard edge
			expect(svg).toContain('<feComponentTransfer><feFuncA type="linear"');
			// blurred lines are faded to approximate MapLibre: width/(width+opacityK*blur) = 2/6.5
			expect(svg).toContain('opacity="0.308"');
		});

		test('does not emit a blur filter when line-blur is 0', () => {
			const r = makeRenderer();
			const feature = makeLineFeature([
				[
					[0, 50],
					[100, 50],
				],
			]);
			r.drawLineStrings('line-test', [[feature, lineStyle({ blur: 0 })]]);
			const svg = r.getString();
			expect(svg).not.toContain('feGaussianBlur');
			expect(svg).not.toContain('filter="url(#line-blur');
		});

		test('deduplicates blur filters by radius', () => {
			const r = makeRenderer();
			const f = (): Feature =>
				makeLineFeature([
					[
						[0, 50],
						[100, 50],
					],
				]);
			r.drawLineStrings('line-test', [
				[f(), lineStyle({ blur: 3, color: mc('#FF0000') })],
				[f(), lineStyle({ blur: 3, color: mc('#00FF00') })],
				[f(), lineStyle({ blur: 5, color: mc('#0000FF') })],
			]);
			const svg = r.getString();
			// Two distinct radii => exactly two filter defs.
			expect((svg.match(/<filter id="line-blur-/g) ?? []).length).toBe(2);
		});
	});

	describe('drawCircles', () => {
		function makePointFeature(points: [number, number][]): Feature {
			return new Feature({
				type: 'Point',
				properties: {},
				geometry: points.map(([x, y]) => [new Point2D(x, y)]),
			});
		}

		function defaultCircleStyle(overrides: Partial<CircleStyle> = {}): CircleStyle {
			return {
				color: mc('#FF0000'),
				opacity: 1,
				radius: 5,
				translate: [0, 0] as [number, number],
				strokeWidth: 0,
				strokeColor: mc('#000000'),
				...overrides,
			};
		}

		test('generates circle elements with correct attributes', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawCircles('circle-test', [[feature, defaultCircleStyle()]]);
			const svg = r.getString();
			expect(svg).toContain('<g id="circle-test">');
			expect(svg).toContain('<circle');
			expect(svg).toContain('cx=');
			expect(svg).toContain('cy=');
			expect(svg).toContain('r="5"');
			expect(svg).toContain('fill="#FF0000"');
		});

		test('empty features produce no output', () => {
			const r = makeRenderer();
			r.drawCircles('circle-test', []);
			const svg = r.getString();
			expect(svg).not.toContain('<circle');
		});

		test('zero opacity produces no output', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawCircles('circle-test', [[feature, defaultCircleStyle({ opacity: 0 })]]);
			const svg = r.getString();
			expect(svg).not.toContain('<circle');
		});

		test('zero-radius circles produce no output', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawCircles('circle-test', [[feature, defaultCircleStyle({ radius: 0 })]]);
			const svg = r.getString();
			expect(svg).not.toContain('<circle');
		});

		test('stroke attributes appear when strokeWidth > 0', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawCircles('circle-test', [
				[feature, defaultCircleStyle({ strokeWidth: 2, strokeColor: mc('#00FF00') })],
			]);
			const svg = r.getString();
			expect(svg).toContain('stroke="#00FF00"');
			expect(svg).toContain('stroke-width="2"');
		});

		test('no stroke attributes when strokeWidth is 0', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawCircles('circle-test', [[feature, defaultCircleStyle({ strokeWidth: 0 })]]);
			const svg = r.getString();
			expect(svg).not.toContain('stroke=');
			expect(svg).not.toContain('stroke-width=');
		});
	});

	describe('drawRasterTiles', () => {
		function defaultRasterStyle(overrides: Partial<RasterStyle> = {}): RasterStyle {
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

		function makeTile(overrides: Partial<RasterTile> = {}): RasterTile {
			return {
				x: 0,
				y: 0,
				width: 256,
				height: 256,
				dataUri: 'data:image/png;base64,AAAA',
				...overrides,
			};
		}

		test('generates image elements', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle());
			const svg = r.getString();
			expect(svg).toContain('<image');
			expect(svg).toContain('href="data:image/png;base64,AAAA"');
			expect(svg).toContain('id="raster-test"');
		});

		test('multiple tiles generate multiple image elements', () => {
			const r = makeRenderer();
			const tiles = [makeTile({ x: 0, y: 0 }), makeTile({ x: 256, y: 0 })];
			r.drawRasterTiles('raster-test', tiles, defaultRasterStyle());
			const svg = r.getString();
			const imageCount = (svg.match(/<image /g) ?? []).length;
			expect(imageCount).toBe(2);
		});

		test('empty tiles produce no output', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [], defaultRasterStyle());
			const svg = r.getString();
			expect(svg).not.toContain('<image');
			expect(svg).not.toContain('<g opacity');
		});

		test('zero opacity produces no output', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ opacity: 0 }));
			const svg = r.getString();
			expect(svg).not.toContain('<image');
		});

		test('applies opacity attribute', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ opacity: 0.5 }));
			const svg = r.getString();
			expect(svg).toContain('opacity="0.5"');
		});

		test('applies hue-rotate filter', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ hueRotate: 90 }));
			const svg = r.getString();
			expect(svg).toContain('filter="hue-rotate(90deg)"');
		});

		test('applies saturate filter', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ saturation: 0.5 }));
			const svg = r.getString();
			expect(svg).toContain('saturate(1.5)');
		});

		test('applies contrast filter', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ contrast: -0.5 }));
			const svg = r.getString();
			expect(svg).toContain('contrast(0.5)');
		});

		test('applies brightness filter', () => {
			const r = makeRenderer();
			r.drawRasterTiles(
				'raster-test',
				[makeTile()],
				defaultRasterStyle({ brightnessMin: 0.2, brightnessMax: 0.8 }),
			);
			const svg = r.getString();
			expect(svg).toContain('brightness(0.5)');
		});

		test('no filter attribute when all defaults', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle());
			const svg = r.getString();
			expect(svg).not.toContain('filter=');
		});

		test('nearest resampling adds image-rendering:pixelated', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ resampling: 'nearest' }));
			const svg = r.getString();
			expect(svg).toContain('image-rendering:pixelated');
		});

		test('linear resampling does not add image-rendering', () => {
			const r = makeRenderer();
			r.drawRasterTiles('raster-test', [makeTile()], defaultRasterStyle({ resampling: 'linear' }));
			const svg = r.getString();
			expect(svg).not.toContain('image-rendering');
		});
	});

	describe('drawLabels', () => {
		function makePointFeature(points: [number, number][]): Feature {
			return new Feature({
				type: 'Point',
				properties: {},
				geometry: points.map(([x, y]) => [new Point2D(x, y)]),
			});
		}

		function defaultSymbolStyle(overrides: Partial<SymbolStyle> = {}): SymbolStyle {
			return {
				text: 'Hello',
				size: 16,
				font: ['Arial'],
				anchor: 'center',
				offset: [0, 0] as [number, number],
				rotate: 0,
				color: mc('#333333'),
				opacity: 1,
				haloColor: mc('#FFFFFF'),
				haloWidth: 0,
				...overrides,
			};
		}

		test('generates text elements', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle()]]);
			const svg = r.getString();
			expect(svg).toContain('<g id="symbol-test">');
			expect(svg).toContain('<text');
			expect(svg).toContain('>Hello</text>');
			expect(svg).toContain('font-family="Arial, Helvetica, Arial, sans-serif"');
			expect(svg).toContain('fill="#333333"');
		});

		test('empty features produce no output', () => {
			const r = makeRenderer();
			r.drawLabels('symbol-test', []);
			const svg = r.getString();
			expect(svg).not.toContain('<text');
		});

		test('empty text produces no output', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ text: '' })]]);
			const svg = r.getString();
			expect(svg).not.toContain('<text');
		});

		test('zero opacity produces no output', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ opacity: 0 })]]);
			const svg = r.getString();
			expect(svg).not.toContain('<text');
		});

		test('applies text anchor mapping', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ anchor: 'left' })]]);
			const svg = r.getString();
			expect(svg).toContain('text-anchor="start"');
			expect(svg).toContain('dominant-baseline="central"');
		});

		test('applies rotation', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ rotate: 45 })]]);
			const svg = r.getString();
			expect(svg).toContain('transform="rotate(45,');
		});

		test('applies halo when haloWidth > 0', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [
				[feature, defaultSymbolStyle({ haloWidth: 2, haloColor: mc('#FFFFFF') })],
			]);
			const svg = r.getString();
			expect(svg).toContain('paint-order="stroke fill"');
			expect(svg).toContain('stroke="#FFFFFF"');
			expect(svg).toContain('stroke-linejoin="round"');
		});

		test('no halo attributes when haloWidth is 0', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ haloWidth: 0 })]]);
			const svg = r.getString();
			expect(svg).not.toContain('paint-order');
			expect(svg).not.toContain('stroke=');
		});

		test('applies offset as dx/dy', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ offset: [1, 0.5], size: 16 })]]);
			const svg = r.getString();
			expect(svg).toContain('dx=');
			expect(svg).toContain('dy=');
		});

		test('escapes XML special characters in text', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ text: '<b>A&B</b>' })]]);
			const svg = r.getString();
			expect(svg).toContain('&lt;b&gt;A&amp;B&lt;/b&gt;');
		});

		test('uses midpoint for line features', () => {
			const feature = new Feature({
				type: 'LineString',
				properties: {},
				geometry: [[new Point2D(0, 0), new Point2D(50, 50), new Point2D(100, 100)]],
			});
			const r = makeRenderer();
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle()]]);
			const svg = r.getString();
			expect(svg).toContain('<text');
			// midpoint is (50,50), scaled by 10 → 500, formatNum → "50"
			expect(svg).toContain('x="50"');
			expect(svg).toContain('y="50"');
		});

		test('applies opacity attribute when < 1', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawLabels('symbol-test', [[feature, defaultSymbolStyle({ opacity: 0.5 })]]);
			const svg = r.getString();
			expect(svg).toContain('opacity="0.500"');
		});
	});

	describe('drawIcons', () => {
		function makePointFeature(points: [number, number][]): Feature {
			return new Feature({
				type: 'Point',
				properties: {},
				geometry: points.map(([x, y]) => [new Point2D(x, y)]),
			});
		}

		function defaultIconStyle(overrides: Partial<IconStyle> = {}): IconStyle {
			return {
				image: 'airport',
				size: 1,
				anchor: 'center',
				offset: [0, 0] as [number, number],
				rotate: 0,
				opacity: 1,
				sdf: false,
				color: mc('#000000'),
				haloColor: mc('#000000', 0),
				haloWidth: 0,
				...overrides,
			};
		}

		function makeSpriteAtlas(
			entries?: Record<string, { x: number; y: number; width: number; height: number }>,
		): SpriteAtlas {
			const atlas: SpriteAtlas = new Map();
			const defaultEntries = entries ?? {
				airport: { x: 0, y: 0, width: 32, height: 32 },
			};
			for (const [name, e] of Object.entries(defaultEntries)) {
				atlas.set(name, {
					...e,
					pixelRatio: 1,
					sdf: false,
					sheetDataUri: 'data:image/png;base64,AAAA',
					sheetWidth: 256,
					sheetHeight: 256,
				});
			}
			return atlas;
		}

		test('generates symbol and use element for icon', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons('icon-test', [[feature, defaultIconStyle()]], makeSpriteAtlas());
			const svg = r.getString();
			expect(svg).toContain('<g id="icon-test">');
			// Shared sprite sheet image in defs
			expect(svg).toContain('<image id="sprite-sheet-0" width="256" height="256"');
			expect(svg).toContain('href="data:image/png;base64,AAAA"');
			// ClipPath and symbol with <g clip-path> wrapping <use>
			expect(svg).toContain(
				'<clipPath id="sprite-airport-clip"><rect width="32" height="32" /></clipPath>',
			);
			expect(svg).toContain(
				'<symbol id="sprite-airport"><g clip-path="url(#sprite-airport-clip)"><use xlink:href="#sprite-sheet-0" x="0" y="0" /></g></symbol>',
			);
			// Icon rendered as <use> inside positioned <g>
			expect(svg).toContain('<use xlink:href="#sprite-airport"');
		});

		test('empty features produce no output', () => {
			const r = makeRenderer();
			r.drawIcons('icon-test', [], makeSpriteAtlas());
			const svg = r.getString();
			expect(svg).not.toContain('<image');
			expect(svg).not.toContain('icon-test');
		});

		test('missing sprite produces no output', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons(
				'icon-test',
				[[feature, defaultIconStyle({ image: 'nonexistent' })]],
				makeSpriteAtlas(),
			);
			const svg = r.getString();
			expect(svg).not.toContain('<image');
			expect(svg).not.toContain('icon-test');
		});

		test('zero opacity produces no output', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons('icon-test', [[feature, defaultIconStyle({ opacity: 0 })]], makeSpriteAtlas());
			const svg = r.getString();
			expect(svg).not.toContain('<image');
			expect(svg).not.toContain('icon-test');
		});

		test('applies rotation', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons('icon-test', [[feature, defaultIconStyle({ rotate: 45 })]], makeSpriteAtlas());
			const svg = r.getString();
			expect(svg).toContain('rotate(45,');
		});

		test('applies opacity when < 1', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons('icon-test', [[feature, defaultIconStyle({ opacity: 0.5 })]], makeSpriteAtlas());
			const svg = r.getString();
			expect(svg).toContain('opacity="0.500"');
		});

		test('scales icon by size and pixelRatio', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			const atlas: SpriteAtlas = new Map();
			atlas.set('icon', {
				x: 0,
				y: 0,
				width: 20,
				height: 20,
				pixelRatio: 2,
				sdf: false,
				sheetDataUri: 'data:image/png;base64,AAAA',
				sheetWidth: 256,
				sheetHeight: 256,
			});
			r.drawIcons('icon-test', [[feature, defaultIconStyle({ image: 'icon', size: 2 })]], atlas);
			const svg = r.getString();
			// size=2, pixelRatio=2 → scale=1 → no scale() transform needed
			// Symbol defined at native sprite size (20x20 in 10x coords → "20" x "20")
			expect(svg).toContain(
				'<clipPath id="sprite-icon-clip"><rect width="20" height="20" /></clipPath>',
			);
			expect(svg).toContain(
				'<symbol id="sprite-icon"><g clip-path="url(#sprite-icon-clip)"><use xlink:href="#sprite-sheet-0" x="0" y="0" /></g></symbol>',
			);
			// Shared sheet image in defs at native size (256*10=2560 → "256")
			expect(svg).toContain('<image id="sprite-sheet-0" width="256" height="256"');
			// Instance has no scale() since scale=1
			expect(svg).not.toContain('scale(');
		});

		test('applies scale transform when size differs from pixelRatio', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons('icon-test', [[feature, defaultIconStyle({ size: 0.5 })]], makeSpriteAtlas());
			const svg = r.getString();
			// size=0.5, pixelRatio=1 → scale=0.5
			expect(svg).toContain('scale(0.5)');
		});

		test('SDF icon applies color filter with threshold', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons(
				'icon-test',
				[[feature, defaultIconStyle({ sdf: true, color: mc('#FF0000') })]],
				makeSpriteAtlas(),
			);
			const svg = r.getString();
			expect(svg).toContain(
				'<filter id="sdf-0" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">',
			);
			// Threshold step for sharp edges
			expect(svg).toContain('feComponentTransfer');
			expect(svg).toContain('tableValues="0 0 0 1"');
			expect(svg).toContain('flood-color="#FF0000"');
			expect(svg).toContain('filter="url(#sdf-0)"');
		});

		test('SDF icon with halo applies threshold and dilate filter', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons(
				'icon-test',
				[
					[
						feature,
						defaultIconStyle({
							sdf: true,
							color: mc('#FF0000'),
							haloColor: mc('#FFFFFF'),
							haloWidth: 2,
						}),
					],
				],
				makeSpriteAtlas(),
			);
			const svg = r.getString();
			expect(svg).toContain('<filter id="sdf-0" color-interpolation-filters="sRGB">');
			// Threshold step
			expect(svg).toContain('feComponentTransfer');
			expect(svg).toContain('tableValues="0 0 0 1"');
			// Dilate for halo
			expect(svg).toContain('feMorphology');
			expect(svg).toContain('operator="dilate"');
			expect(svg).toContain('radius="2"');
			expect(svg).toContain('flood-color="#FFFFFF"');
			expect(svg).toContain('flood-color="#FF0000"');
			expect(svg).toContain('filter="url(#sdf-0)"');
		});

		test('non-SDF icon has no filter', () => {
			const r = makeRenderer();
			const feature = makePointFeature([[100, 50]]);
			r.drawIcons('icon-test', [[feature, defaultIconStyle({ sdf: false })]], makeSpriteAtlas());
			const svg = r.getString();
			expect(svg).not.toContain('<filter');
			expect(svg).not.toContain('filter="url(');
		});

		test('SDF icons with same color share filter', () => {
			const r = makeRenderer();
			const f1 = makePointFeature([[100, 50]]);
			const f2 = makePointFeature([[200, 50]]);
			const atlas = makeSpriteAtlas({
				airport: { x: 0, y: 0, width: 32, height: 32 },
				bus: { x: 32, y: 0, width: 32, height: 32 },
			});
			r.drawIcons(
				'icon-test',
				[
					[f1, defaultIconStyle({ image: 'airport', sdf: true, color: mc('#FF0000') })],
					[f2, defaultIconStyle({ image: 'bus', sdf: true, color: mc('#FF0000') })],
				],
				atlas,
			);
			const svg = r.getString();
			// Only one filter definition
			const filterCount = (svg.match(/<filter /g) ?? []).length;
			expect(filterCount).toBe(1);
		});
	});
});
