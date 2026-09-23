import { Point2D, Feature } from '../geometry.js';
import type { RenderJob } from '../renderer/svg.js';
import { calculateTileGrid, getTile, loadSourceTile, type TileLoader } from './tiles.js';
import type { LayerFeatures } from '../geometry.js';
import type { Projection } from '../projection.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { clipLine, clipPolygon, clipPolygonOutline, exceedsSquare, type XY } from './clip.js';

const TILE_EXTENT = 4096;
const VTFeatureType = { Unknown: 0, Point: 1, LineString: 2, Polygon: 3 } as const;

interface VectorSourceSpec {
	type: 'vector';
	tiles?: string[];
	minzoom?: number;
	maxzoom?: number;
	scheme?: string;
	bounds?: number[];
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
		if (tile) addTileFeatures(tile.buffer, projection, layerFeatures, width, height);
	});
}

/** Decodes one vector tile and adds its features, projected to the screen. */
function addTileFeatures(
	buffer: ArrayBuffer,
	{ project, clipToTile }: TileProjection,
	layerFeatures: LayerFeatures,
	width: number,
	height: number,
): void {
	const vectorTile = new VectorTile(new PbfReader(buffer));
	for (const [name, layer] of Object.entries(vectorTile.layers)) {
		let features = layerFeatures.get(name);
		if (!features) {
			features = { points: [], linestrings: [], polygons: [] };
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
			let outline: Point2D[][] | undefined;
			// Clip polygons and lines to the tile, like MapLibre's stencil clipping: otherwise
			// the parts in the tile buffer are drawn twice, which shows when translucent.
			if (clipToTile && type !== 'Point' && exceedsSquare(rings, 0, TILE_EXTENT)) {
				if (type === 'Polygon') {
					outline = project('LineString', clipPolygonOutline(rings, 0, TILE_EXTENT));
					rings = clipPolygon(rings, 0, TILE_EXTENT);
				} else {
					rings = rings.flatMap((line) => clipLine(line, 0, TILE_EXTENT));
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
					if (feature.doesOverlap([0, 0, width, height])) list.push(feature);
				}
			} else {
				const feature = new Feature({
					type,
					geometry,
					outline,
					id: featureSrc.id,
					properties: featureSrc.properties,
				});
				if (feature.doesOverlap([0, 0, width, height])) list.push(feature);
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

	const { zoomLevel, tileSize, tiles } = calculateTileGrid(
		width,
		height,
		center,
		zoom,
		source.maxzoom,
	);
	return tiles.map(({ x, y, offsetX, offsetY }) => {
		const offset = new Point2D(offsetX, offsetY);
		return {
			x,
			y,
			z: zoomLevel,
			clipToTile: true,
			project: (_type, rings) =>
				rings.map((ring) =>
					ring.map((point) =>
						new Point2D(point.x, point.y).scale(tileSize / TILE_EXTENT).translate(offset),
					),
				),
		};
	});
}
