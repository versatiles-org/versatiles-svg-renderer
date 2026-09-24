import type {
	Feature as MapLibreFeature,
	Point2D as MapLibrePoint2D,
} from '@maplibre/maplibre-gl-style-spec';

type Properties = Record<string, unknown>;

type Patterns = Record<
	string,
	{
		min: string;
		mid: string;
		max: string;
	}
>;

type Geometry = Point2D[][];
type Bbox = [number, number, number, number];

export interface Features {
	points: Feature[];
	linestrings: Feature[];
	polygons: Feature[];
	/**
	 * Polygon boundaries materialized as lines, so `line` layers can stroke polygon
	 * rings (MapLibre parity). Kept separate from `linestrings` so `fill` layers do
	 * NOT fill them a second time (the polygon itself is already in `polygons`).
	 */
	polygonOutlines?: Feature[];
	/**
	 * The vertices of lines and polygons, as points: a `circle` layer draws a circle at each
	 * (as MapLibre does); other layers leave them out.
	 */
	vertices?: Feature[];
}

/**
 * How far beyond the image a feature is still kept, in pixels: a circle, icon, label or
 * stroke around a point or line just outside can reach into the image. As far as symbols
 * are placed beyond it (see `collision.ts`).
 */
export const VIEW_MARGIN = 100;

/** The area features are kept in, for an image of `width` × `height` pixels. */
export function viewArea(width: number, height: number): [number, number, number, number] {
	return [-VIEW_MARGIN, -VIEW_MARGIN, width + VIEW_MARGIN, height + VIEW_MARGIN];
}

export type LayerFeatures = Map<string, Features>;

/** The features of each source, by source name. Layer names only need to be unique per source. */
export type SourceFeatures = Map<string, LayerFeatures>;

/** The layer name a GeoJSON source keeps its features under: GeoJSON has no layers. */
export const GEOJSON_LAYER = '';

export class Point2D implements MapLibrePoint2D {
	public x: number;

	public y: number;

	public constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}

	public isZero(): boolean {
		return this.x === 0 && this.y === 0;
	}

	public scale(factor: number): this {
		this.x *= factor;
		this.y *= factor;
		return this;
	}

	public translate(offset: Point2D): this {
		this.x += offset.x;
		this.y += offset.y;
		return this;
	}

	public getProject2Pixel(): Point2D {
		const s = Math.sin((this.y * Math.PI) / 180.0);
		return new Point2D(this.x / 360.0 + 0.5, 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI);
	}
}

export class Feature implements MapLibreFeature {
	public readonly type: 'LineString' | 'Point' | 'Polygon';

	public readonly id: unknown;

	public readonly properties: Properties;

	public readonly patterns?: Patterns;

	public readonly geometry: Geometry;

	/**
	 * The boundary of a polygon for the fill-antialias outline, as open polylines — when it
	 * differs from the polygon's rings, i.e. when the polygon was clipped to its tile: the
	 * clipped edges along the tile border are not part of the outline.
	 */
	public readonly outline?: Geometry;

	#bbox: Bbox | undefined;

	public constructor(opt: {
		type: 'LineString' | 'Point' | 'Polygon';
		id?: unknown;
		properties: Properties;
		patterns?: Patterns;
		geometry: Geometry;
		outline?: Geometry;
	}) {
		this.type = opt.type;
		this.id = opt.id;
		this.properties = opt.properties;
		this.patterns = opt.patterns;
		this.geometry = opt.geometry;
		this.outline = opt.outline;
	}

	public getBbox(): Bbox {
		if (this.#bbox) return this.#bbox;
		let xMin = Infinity;
		let yMin = Infinity;
		let xMax = -Infinity;
		let yMax = -Infinity;
		this.geometry.forEach((ring) => {
			ring.forEach((point) => {
				if (xMin > point.x) xMin = point.x;
				if (yMin > point.y) yMin = point.y;
				if (xMax < point.x) xMax = point.x;
				if (yMax < point.y) yMax = point.y;
			});
		});
		this.#bbox = [xMin, yMin, xMax, yMax];
		return this.#bbox;
	}

	public doesOverlap(bbox: Bbox): boolean {
		const featureBbox = this.getBbox();
		if (featureBbox[0] > bbox[2]) return false;
		if (featureBbox[1] > bbox[3]) return false;
		if (featureBbox[2] < bbox[0]) return false;
		if (featureBbox[3] < bbox[1]) return false;
		return true;
	}
}
