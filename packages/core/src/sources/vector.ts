import { Feature, type LayerFeatures, Point2D, type Projection, viewArea } from '../geo/index.js';
import type { RenderJob } from '../types.js';
import { calculateTileGrid, getTile, loadSourceTile, type TileLoader } from './tiles.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import {
	clipLineMeasured,
	clipPolygon,
	clipPolygonOutline,
	clipPolygonToBox,
	exceedsBox,
	exceedsSquare,
	type Box,
	type XY,
} from './clip.js';
import { decodeMLT, type TileLayer } from './mlt.js';

const TILE_EXTENT = 4096;
/**
 * How far along a line MapLibre measures before it starts again from zero: two tiles
 * (`MAX_LINE_DISTANCE / 2` in its `line_bucket.ts`, for its tile extent of 8192).
 */
const MAX_LINE_DISTANCE = 2 * TILE_EXTENT;
const VTFeatureType = { Unknown: 0, Point: 1, LineString: 2, Polygon: 3 } as const;

interface VectorSourceSpec {
	type: 'vector';
	tiles?: string[];
	minzoom?: number;
	maxzoom?: number;
	scheme?: string;
	bounds?: number[];
	/** How the tiles are encoded: `"mvt"` (the default) or `"mlt"`. */
	encoding?: string;
}

export async function loadVectorSource(
	source: VectorSourceSpec,
	job: RenderJob,
	layerFeatures: LayerFeatures,
	loadTile: TileLoader = getTile,
): Promise<void> {
	const tiles = source.tiles;
	if (!tiles) return;

	const { width, height } = job.renderer;

	// The tiles load in parallel, but are decoded in tile order, not in the order they
	// arrive: the same tiles must always give the same features in the same order, or
	// overlapping features would be drawn in a different order from one render to the next.
	const projections = getTileProjections(source, job);
	const loaded = await Promise.all(
		projections.map(({ x, y, z }) => loadSourceTile({ ...source, tiles }, z, x, y, loadTile)),
	);
	projections.forEach((projection, i) => {
		const tile = loaded[i];
		if (!tile) return;
		const layers = decodeVectorTile(tile.buffer, source.encoding);
		addTileFeatures(layers, projection, layerFeatures, width, height);
	});
}

/** The layers of a vector tile, decoded as MVT or, with `encoding: "mlt"`, as MLT. */
function decodeVectorTile(buffer: ArrayBuffer, encoding?: string): Record<string, TileLayer> {
	if (encoding === 'mlt') return decodeMLT(buffer);
	return new VectorTile(new PbfReader(buffer)).layers;
}

/** Adds the features of one vector tile's layers, projected to the screen. */
function addTileFeatures(
	layers: Record<string, TileLayer>,
	{ project, clipToTile, pixelsPerUnit, fillBox }: TileProjection,
	layerFeatures: LayerFeatures,
	width: number,
	height: number,
): void {
	for (const [name, layer] of Object.entries(layers)) {
		// Geometry is in units of the layer's extent, which MapLibre scales to its own.
		const scale = layer.extent > 0 ? TILE_EXTENT / layer.extent : 1;
		let features = layerFeatures.get(name);
		if (!features) {
			features = { points: [], linestrings: [], polygons: [], polygonOutlines: [] };
			layerFeatures.set(name, features);
		}

		for (let i = 0; i < layer.length; i++) {
			const featureSrc = layer.feature(i);
			let type: 'LineString' | 'Point' | 'Polygon';
			let list: Feature[];
			switch (featureSrc.type) {
				case VTFeatureType.Unknown:
					throw Error('Unknown feature type in vector tile');
				case VTFeatureType.Point:
					type = 'Point';
					list = features.points;
					break;
				case VTFeatureType.LineString:
					type = 'LineString';
					list = features.linestrings;
					break;
				case VTFeatureType.Polygon:
					type = 'Polygon';
					list = features.polygons;
					break;
			}

			let rings: XY[][] = featureSrc.loadGeometry();
			if (scale !== 1)
				rings = rings.map((ring) => ring.map((p) => ({ x: p.x * scale, y: p.y * scale })));
			let outline: Point2D[][] | undefined;
			let fillGeometry: Point2D[][] | undefined;
			let lineStarts: number[] | undefined;
			// Clip polygons and lines to the tile, like MapLibre's stencil clipping: otherwise
			// the parts in the tile buffer are drawn twice, which shows when translucent.
			if (clipToTile && type !== 'Point' && exceedsSquare(rings, 0, TILE_EXTENT)) {
				if (type === 'Polygon') {
					outline = project('LineString', clipPolygonOutline(rings, 0, TILE_EXTENT));
					if (fillBox) {
						fillGeometry = project(
							'Polygon',
							exceedsBox(rings, fillBox) ? clipPolygonToBox(rings, fillBox) : rings,
						);
					}
					rings = clipPolygon(rings, 0, TILE_EXTENT);
				} else {
					const parts = rings.flatMap((line) =>
						clipLineMeasured(line, 0, TILE_EXTENT, MAX_LINE_DISTANCE),
					);
					rings = parts.map(({ points }) => points);
					if (pixelsPerUnit !== undefined) {
						lineStarts = parts.map(({ start }) => start * pixelsPerUnit);
					}
				}
			}
			const geometry = project(type, rings);
			if (geometry.length === 0) continue;

			// Split MultiPoint into individual Point features
			if (type === 'Point' && geometry.length > 1) {
				for (const ring of geometry) {
					const feature = new Feature({
						type,
						geometry: [ring],
						id: featureSrc.id,
						properties: featureSrc.properties,
					});
					if (feature.doesOverlap(viewArea(width, height))) list.push(feature);
				}
			} else {
				const feature = new Feature({
					type,
					geometry,
					outline,
					fillGeometry,
					lineStarts,
					id: featureSrc.id,
					properties: featureSrc.properties,
				});
				if (!feature.doesOverlap(viewArea(width, height))) continue;
				list.push(feature);
				// What a `line` layer strokes of a polygon: its rings, or, where the polygon was
				// clipped to the tile, the outline without the clipped edges (MapLibre draws the
				// whole ring and clips it to the tile, which hides the edges in the buffer).
				if (type === 'Polygon') {
					features.polygonOutlines!.push(
						new Feature({
							type,
							geometry: outline ?? geometry,
							id: featureSrc.id,
							properties: featureSrc.properties,
						}),
					);
				}
			}
		}
	}
}

interface TileProjection {
	x: number;
	y: number;
	z: number;
	/**
	 * Whether polygons and lines are clipped to the tile. On the globe, not for tiles crossing the
	 * horizon: the zero-width edges the clipping leaves along the tile border would confuse the
	 * horizon clipping, which relies on the polygon's interior always lying right of its rings.
	 */
	clipToTile: boolean;
	/** Pixels per tile unit, where that is the same all over the tile: not on the globe. */
	pixelsPerUnit?: number;
	/**
	 * Where opaque fills are clipped instead of the tile, in tile units: the tile, widened to
	 * whole pixels (see `pixelAlignedBox`). Undefined where that is the tile itself, or where
	 * the tile's borders are no straight lines along the pixel grid.
	 */
	fillBox?: Box;
	/** Converts geometry in tile coordinates (0..TILE_EXTENT) to screen pixels. */
	project: (
		type: 'LineString' | 'Point' | 'Polygon',
		rings: { x: number; y: number }[][],
	) => Point2D[][];
}

function getTileProjections(source: VectorSourceSpec, job: RenderJob): TileProjection[] {
	const { width, height } = job.renderer;
	const { zoom, center } = job.view;
	const projection: Projection | undefined = job.projection;

	if (projection?.isGlobe) {
		// Never zoom level 0 on the globe: the left and right edge of its single tile coincide
		// (the antimeridian), which the horizon clipping cannot tell apart.
		const z = Math.max(1, Math.min(Math.floor(zoom), source.maxzoom ?? Infinity));
		const scale = 1 / (TILE_EXTENT * 2 ** z);
		return projection.coveringTiles(z).map(({ x, y }) => ({
			x,
			y,
			z,
			clipToTile: projection.isTileFullyVisible({ x, y, z }),
			project: (type, rings) =>
				projection.projectGeometry(
					type,
					rings.map((ring) =>
						ring.map((p): [number, number] => [
							(x * TILE_EXTENT + p.x) * scale,
							(y * TILE_EXTENT + p.y) * scale,
						]),
					),
				),
		}));
	}

	// A turned or moved map (bearing, padding) needs the tiles of the north-up area around
	// the image, and turns and moves their points into place.
	const moved = projection?.isTransformed ? projection : undefined;
	const covered = moved ? moved.coveredSize : { width, height };
	const { zoomLevel, tileSize, tiles } = calculateTileGrid(
		covered.width,
		covered.height,
		center,
		zoom,
		source.maxzoom,
	);
	return tiles.map(({ x, y, offsetX, offsetY }) => {
		const offset = new Point2D(
			offsetX + (width - covered.width) / 2,
			offsetY + (height - covered.height) / 2,
		);
		const scale = tileSize / TILE_EXTENT;
		const project: TileProjection['project'] = (_type, rings) =>
			rings.map((ring) =>
				ring.map((point) => {
					const p = new Point2D(point.x, point.y).scale(scale).translate(offset);
					return moved ? moved.fromNorthUp(p.x, p.y) : p;
				}),
			);
		return {
			x,
			y,
			z: zoomLevel,
			clipToTile: true,
			pixelsPerUnit: scale,
			fillBox: pixelAlignedBox(project),
			project,
		};
	});
}

/**
 * The tile, widened to whole pixels on the screen, in tile units, or undefined where that is
 * the tile itself, or where the tile is turned on the screen.
 *
 * Opaque fills are clipped to this box instead of the tile. Where a polygon goes on in the
 * next tile, a fill clipped to the tile ends within a pixel: it covers part of the pixel,
 * and so does every other fill ending there, e.g. a land polygon over a sea polygon, both
 * covering the whole tile. Each is antialiased, so what is below shows through a little, and
 * the tile border shows as a faint line. MapLibre fills the inside of a polygon without
 * antialiasing, so it shows none. Ending on a pixel border, a fill covers each pixel entirely
 * or not at all; the next tile, drawn later, covers the pixels the two tiles share.
 */
function pixelAlignedBox(project: TileProjection['project']): Box | undefined {
	const [corners] = project('LineString', [
		[
			{ x: 0, y: 0 },
			{ x: TILE_EXTENT, y: 0 },
			{ x: 0, y: TILE_EXTENT },
		],
	]);
	const [origin, right, down] = corners!;
	// The tile's x axis must be the screen's, and its y axis the screen's.
	const epsilon = 1e-6;
	if (Math.abs(right!.y - origin!.y) > epsilon || Math.abs(down!.x - origin!.x) > epsilon) {
		return undefined;
	}
	const toTile = (screen: number, start: number, end: number): number =>
		((screen - start) / (end - start)) * TILE_EXTENT;
	const widen = (start: number, end: number): [number, number] => {
		const a = toTile(Math.floor(Math.min(start, end)), start, end);
		const b = toTile(Math.ceil(Math.max(start, end)), start, end);
		return [Math.min(a, b), Math.max(a, b)];
	};
	const [minX, maxX] = widen(origin!.x, right!.x);
	const [minY, maxY] = widen(origin!.y, down!.y);
	if (minX === 0 && minY === 0 && maxX === TILE_EXTENT && maxY === TILE_EXTENT) return undefined;
	return [minX, minY, maxX, maxY];
}
