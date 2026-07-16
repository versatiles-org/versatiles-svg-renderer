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
}

export type LayerFeatures = Map<string, Features>;

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

	#bbox: Bbox | undefined;

	public constructor(opt: {
		type: 'LineString' | 'Point' | 'Polygon';
		id?: unknown;
		properties: Properties;
		patterns?: Patterns;
		geometry: Geometry;
	}) {
		this.type = opt.type;
		this.id = opt.id;
		this.properties = opt.properties;
		this.patterns = opt.patterns;
		this.geometry = opt.geometry;
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
