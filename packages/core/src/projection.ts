import type { ProjectionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Point2D } from './geometry.js';
import type { RasterTriangle } from './renderer/types.js';

/**
 * Map projection: web mercator, MapLibre's globe ("vertical-perspective") or a blend of both.
 *
 * The math follows MapLibre GL JS (`vertical_perspective_transform.ts` and the
 * `_projection_globe.vertex.glsl` shader) for a camera without pitch, bearing or padding:
 * the globe is a sphere of radius `worldSize / (2π·cos(centerLat))` (so the map center has
 * the same scale as in mercator), viewed by a perspective camera `1.5 · height` pixels above
 * the map center. The globe → mercator transition blends the homogeneous clip-space positions
 * of both projections (x, y and w) *before* the perspective divide, exactly like the shader.
 *
 * All inputs are mercator world coordinates in the range 0..1 (`mx` east, `my` south).
 */

/** MapLibre's default vertical field of view (`TransformHelper._fovInRadians`). */
const FOV = 0.6435011087932844;

/** What MapLibre expands `projection: { type: 'globe' }` into (`projection_factory.ts`). */
const GLOBE_PRESET = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	'vertical-perspective',
	12,
	'mercator',
];

/** Below this globeness the far side of the globe is not clipped (MapLibre's `z_globeness_threshold`). */
const CLIP_THRESHOLD = 0.2;

/** Maximum distance (pixels) a straight segment may deviate from the curved globe surface. */
const MAX_CURVE_ERROR_PX = 0.25;

/** The same for the affine-mapped triangles of raster tiles (a coarser mesh keeps the SVG small). */
const MAX_RASTER_ERROR_PX = 1;

/** Upper bound for the number of cells per raster tile side. */
const MAX_RASTER_CELLS = 16;

type Vec3 = [number, number, number];

/** A mercator point together with its position on the unit sphere (view frame). */
interface SpherePoint {
	mx: number;
	my: number;
	v: Vec3;
}

/** A visible part of a ring, from where it enters to where it leaves the visible hemisphere. */
interface HorizonChain {
	/** Angle of the entry point on the horizon circle (view frame). */
	entry: number;
	/** Angle of the exit point on the horizon circle (view frame). */
	exit: number;
	points: Point2D[];
}

/** Angle to go clockwise on screen (decreasing angle in the y-up view frame) from a0 to a1, in [0, 2π). */
function clockwiseDelta(a0: number, a1: number): number {
	const delta = (a0 - a1) % (2 * Math.PI);
	return delta < 0 ? delta + 2 * Math.PI : delta;
}

export interface ClipCircle {
	x: number;
	y: number;
	radius: number;
}

export interface TileID {
	x: number;
	y: number;
	z: number;
}

/**
 * Returns how "globe-like" the projection is at the given zoom, matching MapLibre's
 * `GlobeProjection.transitionState`: 0 = mercator, 1 = globe, in between = transition.
 */
export function getGlobeness(
	projection: ProjectionSpecification | undefined,
	zoom: number,
): number {
	return evaluateGlobeness(projection?.type ?? 'mercator', zoom);
}

function evaluateGlobeness(value: unknown, zoom: number): number {
	if (typeof value === 'string') {
		switch (value) {
			case 'globe':
				return evaluateGlobeness(GLOBE_PRESET, zoom);
			case 'vertical-perspective':
				return 1;
			default:
				return 0;
		}
	}
	if (!Array.isArray(value)) return 0;

	const [op, ...args] = value as unknown[];
	if (op === 'literal') return evaluateGlobeness(args[0], zoom);
	if (op === 'step') {
		// ["step", ["zoom"], output0, stop1, output1, ...]
		let result = args[1];
		for (let i = 2; i + 1 < args.length; i += 2) {
			if (zoom >= (args[i] as number)) result = args[i + 1];
		}
		return evaluateGlobeness(result, zoom);
	}
	if (op === 'interpolate') {
		// ["interpolate", ["linear"] | ["exponential", base], ["zoom"], stop0, output0, ...]
		const interpolation = args[0] as unknown[];
		const base = interpolation[0] === 'exponential' ? (interpolation[1] as number) : 1;
		const stops: [number, unknown][] = [];
		for (let i = 2; i + 1 < args.length; i += 2) stops.push([args[i] as number, args[i + 1]]);
		if (stops.length === 0) return 0;
		if (zoom <= stops[0]![0]) return evaluateGlobeness(stops[0]![1], zoom);
		for (let i = 1; i < stops.length; i++) {
			const [z1, out1] = stops[i]!;
			if (zoom > z1) continue;
			const [z0, out0] = stops[i - 1]!;
			const t = interpolationFactor(zoom, z0, z1, base);
			const g0 = evaluateGlobeness(out0, zoom);
			const g1 = evaluateGlobeness(out1, zoom);
			return g0 + (g1 - g0) * t;
		}
		return evaluateGlobeness(stops[stops.length - 1]![1], zoom);
	}
	// A projection transition literal: [from, to, transition]
	if (value.length === 3 && typeof value[2] === 'number') {
		const g0 = evaluateGlobeness(value[0], zoom);
		const g1 = evaluateGlobeness(value[1], zoom);
		return g0 + (g1 - g0) * value[2];
	}
	return 0;
}

function interpolationFactor(input: number, lower: number, upper: number, base: number): number {
	const difference = upper - lower;
	if (difference === 0) return 0;
	const progress = input - lower;
	if (base === 1) return progress / difference;
	return (Math.pow(base, progress) - 1) / (Math.pow(base, difference) - 1);
}

/** A mercator point wrapped east-west, or `undefined` if it lies beyond the poles. */
function inWorld([mx, my]: [number, number]): [number, number] | undefined {
	if (my < 0 || my > 1) return undefined;
	return [mx - Math.floor(mx), my];
}

/** The latitude where the mercator map ends, north and south: atan(sinh(π)), in degrees. */
export const MAX_LATITUDE = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;

/** Mercator world coordinates (0..1) → longitude and latitude in degrees. */
export function mercatorToLonLat(mx: number, my: number): [number, number] {
	const lon = mx * 360 - 180;
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
	return [lon, lat];
}

/** Space around the map's center, as MapLibre's `padding`, in pixels. */
export interface Padding {
	top?: number;
	right?: number;
	bottom?: number;
	left?: number;
}

export class Projection {
	public readonly width: number;

	public readonly height: number;

	public readonly zoom: number;

	/** 0 = mercator, 1 = globe, in between = transition (see {@link getGlobeness}). */
	public readonly globeness: number;

	/** Size of the whole world in pixels at the current zoom (mercator). */
	public readonly worldSize: number;

	/**
	 * Maximum length (in mercator units) of a straight segment before it has to be
	 * subdivided to follow the curvature of the globe.
	 */
	public readonly maxSegmentLength: number;

	/** Whether geometry on the far side of the globe has to be removed. */
	public readonly clipsHorizon: boolean;

	/**
	 * The compass direction that is up, in degrees, as MapLibre's `bearing`: the map is turned
	 * around the image's center by as much, counterclockwise.
	 */
	public readonly bearing: number;

	readonly #cosBearing: number;

	readonly #sinBearing: number;

	/**
	 * How far the map is moved by MapLibre's `padding`: its center to the middle of the area
	 * inside the padding.
	 */
	readonly #offsetX: number;

	readonly #offsetY: number;

	readonly #centerX: number;

	readonly #centerY: number;

	readonly #centerLng: number;

	readonly #sinLat: number;

	readonly #cosLat: number;

	/** Globe radius in pixels. */
	readonly #radius: number;

	/** Distance of the camera to the map center in pixels. */
	readonly #cameraDistance: number;

	/** Points of the unit sphere with a view-space z below this are behind the horizon. */
	readonly #horizonZ: number;

	public constructor(opt: {
		width: number;
		height: number;
		center: [number, number];
		zoom: number;
		globeness?: number;
		bearing?: number;
		padding?: Padding;
	}) {
		this.bearing = opt.bearing ?? 0;
		const padding = opt.padding ?? {};
		this.#offsetX = ((padding.left ?? 0) - (padding.right ?? 0)) / 2;
		this.#offsetY = ((padding.top ?? 0) - (padding.bottom ?? 0)) / 2;
		const angle = (this.bearing * Math.PI) / 180;
		this.#cosBearing = Math.cos(angle);
		this.#sinBearing = Math.sin(angle);
		this.width = opt.width;
		this.height = opt.height;
		this.zoom = opt.zoom;
		this.globeness = Math.min(1, Math.max(0, opt.globeness ?? 0));
		this.worldSize = 512 * 2 ** opt.zoom;

		const center = new Point2D(opt.center[0], opt.center[1]).getProject2Pixel();
		this.#centerX = center.x;
		this.#centerY = center.y;

		const lat = (opt.center[1] * Math.PI) / 180;
		this.#centerLng = (opt.center[0] * Math.PI) / 180;
		this.#sinLat = Math.sin(lat);
		this.#cosLat = Math.cos(lat);

		this.#radius = this.worldSize / (2 * Math.PI * this.#cosLat);
		this.#cameraDistance = this.height / 2 / Math.tan(FOV / 2);
		this.#horizonZ = this.#radius / (this.#radius + this.#cameraDistance);
		this.clipsHorizon = this.globeness > CLIP_THRESHOLD;

		// A chord spanning the angle θ deviates R·θ²/8 from the sphere.
		const maxAngle = Math.sqrt((8 * MAX_CURVE_ERROR_PX) / this.#radius);
		this.maxSegmentLength = maxAngle / (2 * Math.PI);
	}

	public static fromStyle(opt: {
		width: number;
		height: number;
		center: [number, number];
		zoom: number;
		projection?: ProjectionSpecification;
		bearing?: number;
		padding?: Padding;
	}): Projection {
		return new Projection({ ...opt, globeness: getGlobeness(opt.projection, opt.zoom) });
	}

	/** True when the globe projection is (at least partially) in effect. */
	public get isGlobe(): boolean {
		return this.globeness > 0;
	}

	/**
	 * The silhouette of the globe on screen, if the map has to be clipped to it.
	 * (During the globe → mercator transition the silhouette is far outside the screen.)
	 */
	public get clipCircle(): ClipCircle | undefined {
		if (!this.clipsHorizon) return undefined;
		const r = this.#radius;
		const d = this.#cameraDistance;
		const radius = (d * r) / Math.sqrt((d + r) * (d + r) - r * r);
		return { x: this.width / 2 + this.#offsetX, y: this.height / 2 + this.#offsetY, radius };
	}

	/** Mercator world coordinates → unit sphere in the view frame (x right, y up, z towards the camera). */
	public toSphere(mx: number, my: number): Vec3 {
		const dLng = mx * 2 * Math.PI - Math.PI - this.#centerLng;
		const lat = 2 * Math.atan(Math.exp(Math.PI - my * 2 * Math.PI)) - Math.PI / 2;
		const cosLat = Math.cos(lat);
		const x = Math.sin(dLng) * cosLat;
		const y = Math.sin(lat);
		const z = Math.cos(dLng) * cosLat;
		return [x, y * this.#cosLat - z * this.#sinLat, y * this.#sinLat + z * this.#cosLat];
	}

	/** Inverse of {@link toSphere}. */
	public fromSphere(v: Vec3): [number, number] {
		const y = v[1] * this.#cosLat + v[2] * this.#sinLat;
		const z = -v[1] * this.#sinLat + v[2] * this.#cosLat;
		const lat = Math.asin(Math.max(-1, Math.min(1, y)));
		const lng = Math.atan2(v[0], z) + this.#centerLng;
		const mx = (lng + Math.PI) / (2 * Math.PI);
		const my = (Math.PI - Math.log(Math.tan(Math.PI / 4 + lat / 2))) / (2 * Math.PI);
		return [mx - Math.floor(mx), my];
	}

	public isVisible(v: Vec3): boolean {
		return !this.clipsHorizon || v[2] >= this.#horizonZ;
	}

	/** Screen position of a mercator point. */
	public project(mx: number, my: number, v?: Vec3): Point2D {
		// Flat (mercator) position, relative to the screen center. Use the world copy
		// nearest to the center.
		let dx = mx - this.#centerX;
		dx -= Math.round(dx);
		const flatX = dx * this.worldSize;
		const flatY = (my - this.#centerY) * this.worldSize;
		const t = this.globeness;
		if (t === 0) return this.fromNorthUp(flatX + this.width / 2, flatY + this.height / 2);

		v ??= this.toSphere(mx, my);
		const d = this.#cameraDistance;
		const r = this.#radius;
		// Homogeneous coordinates (x, y, w) of the globe position; the flat one is (d·x, d·y, d).
		const globeX = d * r * v[0];
		const globeY = -d * r * v[1];
		const globeW = d + r * (1 - v[2]);
		const w = d + (globeW - d) * t;
		return this.fromNorthUp(
			(d * flatX + (globeX - d * flatX) * t) / w + this.width / 2,
			(d * flatY + (globeY - d * flatY) * t) / w + this.height / 2,
		);
	}

	/** Whether the map is turned (bearing) or moved (padding) on the image. */
	public get isTransformed(): boolean {
		return this.bearing !== 0 || this.#offsetX !== 0 || this.#offsetY !== 0;
	}

	/**
	 * Where a point of the north-up map, centered on the image, lies on the image: turned by
	 * the bearing around the map's center, and moved with it by the padding.
	 */
	public fromNorthUp(x: number, y: number): Point2D {
		if (!this.isTransformed) return new Point2D(x, y);
		const dx = x - this.width / 2;
		const dy = y - this.height / 2;
		return new Point2D(
			dx * this.#cosBearing + dy * this.#sinBearing + this.width / 2 + this.#offsetX,
			-dx * this.#sinBearing + dy * this.#cosBearing + this.height / 2 + this.#offsetY,
		);
	}

	/** The opposite of {@link Projection.fromNorthUp}. */
	public toNorthUp(x: number, y: number): [number, number] {
		if (!this.isTransformed) return [x, y];
		const dx = x - this.width / 2 - this.#offsetX;
		const dy = y - this.height / 2 - this.#offsetY;
		return [
			dx * this.#cosBearing - dy * this.#sinBearing + this.width / 2,
			dx * this.#sinBearing + dy * this.#cosBearing + this.height / 2,
		];
	}

	/**
	 * The size of the north-up area, centered on the map's center, that covers the whole
	 * image once turned and moved into place: tiles covering it cover the image.
	 */
	public get coveredSize(): { width: number; height: number } {
		let halfWidth = 0;
		let halfHeight = 0;
		for (const [x, y] of [
			[0, 0],
			[this.width, 0],
			[this.width, this.height],
			[0, this.height],
		] as const) {
			const [u, v] = this.toNorthUp(x, y);
			halfWidth = Math.max(halfWidth, Math.abs(u - this.width / 2));
			halfHeight = Math.max(halfHeight, Math.abs(v - this.height / 2));
		}
		return { width: 2 * halfWidth, height: 2 * halfHeight };
	}

	/** How far the padding moves the map on the image, in pixels. */
	public get offset(): [number, number] {
		return [this.#offsetX, this.#offsetY];
	}

	/**
	 * Inverse of {@link project}: the mercator point shown at a screen position, or
	 * `undefined` where the screen shows no map: next to the globe, or beyond the poles of
	 * the mercator map. `mx` is wrapped into 0..1.
	 */
	public unproject(x: number, y: number): [number, number] | undefined {
		const t = this.globeness;
		const [ux, uy] = this.toNorthUp(x, y);
		const flat = this.#unprojectFlat(ux, uy);
		if (t === 0) return inWorld(flat);
		if (t === 1) return this.#unprojectGlobe(ux, uy);

		// The transition has no closed form: find the point by Newton's method, starting
		// from the flat solution, which is close at these zoom levels.
		let [mx, my] = flat;
		const h = 1e-9;
		for (let i = 0; i < 30; i++) {
			const p = this.project(mx, my);
			const ex = p.x - x;
			const ey = p.y - y;
			if (Math.abs(ex) < 1e-7 && Math.abs(ey) < 1e-7) break;
			const px = this.project(mx + h, my);
			const py = this.project(mx, my + h);
			// The Jacobian of project, by finite differences.
			const a = (px.x - p.x) / h;
			const b = (py.x - p.x) / h;
			const c = (px.y - p.y) / h;
			const d = (py.y - p.y) / h;
			const det = a * d - b * c;
			if (det === 0) return undefined;
			mx -= (d * ex - b * ey) / det;
			my -= (a * ey - c * ex) / det;
		}
		const check = this.project(mx, my);
		if (Math.abs(check.x - x) > 1e-3 || Math.abs(check.y - y) > 1e-3) return undefined;
		return inWorld([mx, my]);
	}

	/** Inverse of the flat (mercator) part of {@link project}. */
	#unprojectFlat(x: number, y: number): [number, number] {
		return [
			this.#centerX + (x - this.width / 2) / this.worldSize,
			this.#centerY + (y - this.height / 2) / this.worldSize,
		];
	}

	/**
	 * Inverse of the globe part of {@link project}: where the line of sight through the
	 * screen position meets the globe, on its front side.
	 */
	#unprojectGlobe(x: number, y: number): [number, number] | undefined {
		const d = this.#cameraDistance;
		const r = this.#radius;
		// project gives x' = d·r·v₀ / w and y' = -d·r·v₁ / w with w = d + r·(1 - v₂). With
		// k = (d + r) / r and u = k - v₂, that is v₀ = a·u and v₁ = b·u, and |v| = 1 makes it
		// (a² + b² + 1)·u² - 2k·u + k² - 1 = 0. The smaller root is the front side.
		const a = (x - this.width / 2) / d;
		const b = -(y - this.height / 2) / d;
		const k = (d + r) / r;
		const s = a * a + b * b;
		const discriminant = 1 - s * (k * k - 1);
		if (discriminant < 0) return undefined;
		const u = (k - Math.sqrt(discriminant)) / (s + 1);
		return this.fromSphere([a * u, b * u, k - u]);
	}

	/**
	 * Projects feature geometry given in mercator world coordinates to screen pixels.
	 * On the globe, segments are subdivided to follow the curvature, lines are cut at
	 * the horizon and polygons are clipped to the visible hemisphere (the clipped part of
	 * the boundary follows the globe's silhouette).
	 */
	public projectGeometry(
		type: 'LineString' | 'Point' | 'Polygon',
		rings: [number, number][][],
	): Point2D[][] {
		if (!this.isGlobe) return rings.map((ring) => ring.map(([mx, my]) => this.project(mx, my)));

		switch (type) {
			case 'Point':
				return rings
					.map((ring) =>
						ring.flatMap(([mx, my]) => {
							const v = this.toSphere(mx, my);
							return this.isVisible(v) ? [this.project(mx, my, v)] : [];
						}),
					)
					.filter((ring) => ring.length > 0);
			case 'LineString':
				return rings.flatMap((ring) => this.#clipLine(this.#densify(ring, false)));
			case 'Polygon':
				return this.#clipPolygon(rings.map((ring) => this.#densify(ring, true)));
		}
	}

	/** Subdivides long segments (in mercator space) and lifts the points onto the sphere. */
	#densify(ring: [number, number][], closed: boolean): SpherePoint[] {
		const maxLength = this.maxSegmentLength;
		const result: SpherePoint[] = [];
		const count = ring.length;
		const segments = closed ? count : count - 1;
		for (let i = 0; i < count; i++) {
			const [x0, y0] = ring[i]!;
			result.push({ mx: x0, my: y0, v: this.toSphere(x0, y0) });
			if (i >= segments) continue;
			const [x1, y1] = ring[(i + 1) % count]!;
			const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / maxLength);
			for (let s = 1; s < steps; s++) {
				const mx = x0 + ((x1 - x0) * s) / steps;
				const my = y0 + ((y1 - y0) * s) / steps;
				result.push({ mx, my, v: this.toSphere(mx, my) });
			}
		}
		return result;
	}

	/** Point on the segment a→b where it crosses the horizon plane. */
	#horizonCrossing(a: SpherePoint, b: SpherePoint): SpherePoint {
		const s = (a.v[2] - this.#horizonZ) / (a.v[2] - b.v[2]);
		const mx = a.mx + (b.mx - a.mx) * s;
		const my = a.my + (b.my - a.my) * s;
		return { mx, my, v: this.toSphere(mx, my) };
	}

	/** Splits a line into its visible parts. */
	#clipLine(points: SpherePoint[]): Point2D[][] {
		if (!this.clipsHorizon) return [points.map((p) => this.project(p.mx, p.my, p.v))];

		const parts: Point2D[][] = [];
		let current: Point2D[] = [];
		for (let i = 0; i < points.length; i++) {
			const p = points[i]!;
			const visible = this.isVisible(p.v);
			const prev = i > 0 ? points[i - 1]! : undefined;
			if (prev && this.isVisible(prev.v) !== visible) {
				const c = this.#horizonCrossing(prev, p);
				current.push(this.project(c.mx, c.my, c.v));
				if (!visible) {
					parts.push(current);
					current = [];
				}
			}
			if (visible) current.push(this.project(p.mx, p.my, p.v));
		}
		if (current.length > 0) parts.push(current);
		return parts.filter((part) => part.length > 1);
	}

	/**
	 * Clips the rings of a polygon to the visible hemisphere.
	 *
	 * Every ring crossing the horizon is cut into its visible chains, each running from an
	 * entry point to an exit point on the horizon. The chains are then reconnected along the
	 * silhouette: from an exit point, the silhouette is followed to the nearest entry point
	 * (of any chain of any ring). Rings follow the vector tile winding (exterior rings
	 * clockwise on screen, holes counter-clockwise), which keeps the filled area on the right
	 * of every ring, so the silhouette is always walked clockwise.
	 */
	#clipPolygon(rings: SpherePoint[][]): Point2D[][] {
		const project = (p: SpherePoint): Point2D => this.project(p.mx, p.my, p.v);
		if (!this.clipsHorizon) return rings.map((ring) => ring.map(project));

		const result: Point2D[][] = [];
		const chains: HorizonChain[] = [];
		const angleOf = (p: SpherePoint): number => Math.atan2(p.v[1], p.v[0]);

		for (const ring of rings) {
			const count = ring.length;
			const visible = ring.map((p) => this.isVisible(p.v));

			// Start walking at an entry point, so every chain is complete.
			let start = -1;
			for (let i = 0; i < count; i++) {
				if (visible[i] && !visible[(i + count - 1) % count]) {
					start = i;
					break;
				}
			}
			if (start < 0) {
				// No crossing: the ring is either completely visible or completely hidden.
				if (visible[0]) result.push(ring.map(project));
				continue;
			}

			let chain: HorizonChain | undefined;
			for (let k = 0; k < count; k++) {
				const i = (start + k) % count;
				const p = ring[i]!;
				const prev = ring[(i + count - 1) % count]!;
				if (visible[i]) {
					if (!chain) {
						const c = this.#horizonCrossing(prev, p);
						chain = { entry: angleOf(c), exit: 0, points: [project(c)] };
					}
					chain.points.push(project(p));
				} else if (chain) {
					const c = this.#horizonCrossing(prev, p);
					chain.points.push(project(c));
					chain.exit = angleOf(c);
					chains.push(chain);
					chain = undefined;
				}
			}
		}

		// Reconnect the chains along the silhouette.
		const used = new Set<HorizonChain>();
		for (const first of chains) {
			if (used.has(first)) continue;
			const ring: Point2D[] = [];
			let chain = first;
			for (;;) {
				used.add(chain);
				ring.push(...chain.points);
				let next = first;
				let bestDelta = clockwiseDelta(chain.exit, first.entry);
				for (const candidate of chains) {
					if (used.has(candidate)) continue;
					const delta = clockwiseDelta(chain.exit, candidate.entry);
					if (delta < bestDelta) {
						bestDelta = delta;
						next = candidate;
					}
				}
				this.#pushArc(ring, chain.exit, next.entry);
				if (next === first) break;
				chain = next;
			}
			result.push(ring);
		}
		return result;
	}

	/**
	 * Appends points along the horizon circle, clockwise on screen (decreasing angle in the
	 * y-up view frame) from angle a0 to a1.
	 */
	#pushArc(result: Point2D[], a0: number, a1: number): void {
		const delta = clockwiseDelta(a0, a1);
		const steps = Math.ceil(delta / (Math.PI / 90));
		const h = this.#horizonZ;
		const rho = Math.sqrt(1 - h * h);
		for (let s = 1; s < steps; s++) {
			const a = a0 - (delta * s) / steps;
			const v: Vec3 = [rho * Math.cos(a), rho * Math.sin(a), h];
			const [mx, my] = this.fromSphere(v);
			result.push(this.project(mx, my, v));
		}
	}

	/**
	 * Splits a raster tile into a mesh of triangles, each small enough to be drawn with an
	 * affine transform (see {@link RasterTriangle}). An affine transform is fully determined
	 * by three points, so every triangle meets its projected corners exactly and neighbouring
	 * triangles share their edges. Cells on the far side of the globe are dropped.
	 */
	public rasterTriangles(tile: TileID): RasterTriangle[] {
		const tileSize = 1 / 2 ** tile.z;
		const maxLength = this.maxSegmentLength * Math.sqrt(MAX_RASTER_ERROR_PX / MAX_CURVE_ERROR_PX);
		const n = Math.max(1, Math.min(MAX_RASTER_CELLS, Math.ceil(tileSize / maxLength)));

		// Project the (n+1)² grid corners once.
		const corners: (Point2D | undefined)[] = [];
		for (let j = 0; j <= n; j++) {
			for (let i = 0; i <= n; i++) {
				const mx = (tile.x + i / n) * tileSize;
				const my = (tile.y + j / n) * tileSize;
				let v = this.toSphere(mx, my);
				if (this.isVisible(v)) {
					corners.push(this.project(mx, my, v));
				} else {
					// Pull the corner onto the horizon, so cells at the silhouette end there.
					if (this.#isBehind(v)) {
						corners.push(undefined);
						continue;
					}
					v = this.#clampToHorizon(v);
					const [cx, cy] = this.fromSphere(v);
					corners.push(this.project(cx, cy, v));
				}
			}
		}

		const triangles: RasterTriangle[] = [];
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const p00 = corners[j * (n + 1) + i];
				const p10 = corners[j * (n + 1) + i + 1];
				const p01 = corners[(j + 1) * (n + 1) + i];
				const p11 = corners[(j + 1) * (n + 1) + i + 1];
				if (!p00 || !p10 || !p01 || !p11) continue;
				const minX = Math.min(p00.x, p10.x, p01.x, p11.x);
				const maxX = Math.max(p00.x, p10.x, p01.x, p11.x);
				const minY = Math.min(p00.y, p10.y, p01.y, p11.y);
				const maxY = Math.max(p00.y, p10.y, p01.y, p11.y);
				if (maxX < 0 || minX > this.width || maxY < 0 || minY > this.height) continue;
				if (!this.#isCellVisible(tile, n, i, j)) continue;

				const u0 = i / n;
				const v0 = j / n;
				const u1 = (i + 1) / n;
				const v1 = (j + 1) / n;
				triangles.push(
					{
						source: [
							[u0, v0],
							[u1, v0],
							[u1, v1],
						],
						target: [
							[p00.x, p00.y],
							[p10.x, p10.y],
							[p11.x, p11.y],
						],
					},
					{
						source: [
							[u0, v0],
							[u1, v1],
							[u0, v1],
						],
						target: [
							[p00.x, p00.y],
							[p11.x, p11.y],
							[p01.x, p01.y],
						],
					},
				);
			}
		}
		return triangles;
	}

	/** Whether any part of a raster cell is on the visible side of the globe. */
	#isCellVisible(tile: TileID, n: number, i: number, j: number): boolean {
		if (!this.clipsHorizon) return true;
		const tileSize = 1 / 2 ** tile.z;
		for (let dj = 0; dj <= 2; dj++) {
			for (let di = 0; di <= 2; di++) {
				const mx = (tile.x + (i + di / 2) / n) * tileSize;
				const my = (tile.y + (j + dj / 2) / n) * tileSize;
				if (this.isVisible(this.toSphere(mx, my))) return true;
			}
		}
		return false;
	}

	/** Moves a point on the far side of the globe onto the horizon (keeping its direction on screen). */
	#clampToHorizon(v: Vec3): Vec3 {
		const h = this.#horizonZ;
		const rho = Math.sqrt(1 - h * h);
		const len = Math.hypot(v[0], v[1]);
		if (len < 1e-12) return [rho, 0, h];
		return [(v[0] / len) * rho, (v[1] / len) * rho, h];
	}

	/** Points almost opposite the view direction have no meaningful place on the horizon. */
	#isBehind(v: Vec3): boolean {
		return Math.hypot(v[0], v[1]) < 1e-9;
	}

	/**
	 * Tiles at zoom level `z` that are visible on screen, found by walking down the tile
	 * pyramid and projecting a grid of sample points of each tile.
	 */
	public coveringTiles(z: number): TileID[] {
		const result: TileID[] = [];
		const visit = (tz: number, tx: number, ty: number): void => {
			if (tz >= 2 && !this.#isTileVisible(tz, tx, ty)) return;
			if (tz === z) {
				result.push({ x: tx, y: ty, z: tz });
				return;
			}
			for (let dy = 0; dy < 2; dy++) {
				for (let dx = 0; dx < 2; dx++) visit(tz + 1, tx * 2 + dx, ty * 2 + dy);
			}
		};
		visit(0, 0, 0);
		return result;
	}

	/**
	 * Whether a tile, including a margin around it (the tile buffer, as a fraction of the tile
	 * size), lies completely on the visible side of the globe, so no horizon clipping happens.
	 */
	public isTileFullyVisible(tile: TileID, margin = 0.1): boolean {
		if (!this.clipsHorizon) return true;
		const size = 1 / 2 ** tile.z;
		const samples = 8;
		for (let j = 0; j <= samples; j++) {
			for (let i = 0; i <= samples; i++) {
				if (i !== 0 && i !== samples && j !== 0 && j !== samples) continue; // the border only
				const mx = (tile.x - margin + ((1 + 2 * margin) * i) / samples) * size;
				const my = (tile.y - margin + ((1 + 2 * margin) * j) / samples) * size;
				if (!this.isVisible(this.toSphere(mx, my))) return false;
			}
		}
		return true;
	}

	#isTileVisible(z: number, x: number, y: number): boolean {
		const samples = 6;
		const size = 1 / 2 ** z;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		const addSample = (mx: number, my: number): void => {
			const v = this.toSphere(mx, my);
			if (!this.isVisible(v)) return;
			const p = this.project(mx, my, v);
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		};
		for (let j = 0; j <= samples; j++) {
			for (let i = 0; i <= samples; i++)
				addSample((x + i / samples) * size, (y + j / samples) * size);
		}
		// Zoomed in, the visible part of the globe can be much smaller than the sample spacing.
		// So also sample the point of the tile closest to the map center.
		const x0 = x * size;
		const centerX = this.#centerX - Math.round(this.#centerX - (x0 + size / 2));
		addSample(clamp(centerX, x0, x0 + size), clamp(this.#centerY, y * size, (y + 1) * size));

		// A generous margin: the samples may miss the part of the tile at the silhouette.
		const margin = Math.max(maxX - minX, maxY - minY) / samples + 1;
		return (
			minX - margin <= this.width &&
			maxX + margin >= 0 &&
			minY - margin <= this.height &&
			maxY + margin >= 0
		);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
