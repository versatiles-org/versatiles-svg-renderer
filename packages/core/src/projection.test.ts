import { describe, expect, test } from 'vitest';
import { Point2D } from './geometry.js';
import { getGlobeness, mercatorToLonLat, Projection } from './projection.js';

function mercator(lng: number, lat: number): [number, number] {
	const p = new Point2D(lng, lat).getProject2Pixel();
	return [p.x, p.y];
}

function polygonArea(ring: Point2D[]): number {
	let area = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i]!;
		const b = ring[(i + 1) % ring.length]!;
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

describe('getGlobeness', () => {
	test('mercator and missing projection', () => {
		expect(getGlobeness(undefined, 3)).toBe(0);
		expect(getGlobeness({ type: 'mercator' }, 3)).toBe(0);
	});

	test('vertical-perspective', () => {
		expect(getGlobeness({ type: 'vertical-perspective' }, 15)).toBe(1);
	});

	test('globe transitions to mercator between zoom 11 and 12', () => {
		expect(getGlobeness({ type: 'globe' }, 5)).toBe(1);
		expect(getGlobeness({ type: 'globe' }, 11)).toBe(1);
		expect(getGlobeness({ type: 'globe' }, 11.25)).toBeCloseTo(0.75);
		expect(getGlobeness({ type: 'globe' }, 12)).toBe(0);
		expect(getGlobeness({ type: 'globe' }, 16)).toBe(0);
	});

	test('step and interpolate expressions', () => {
		const step = { type: ['step', ['zoom'], 'vertical-perspective', 6, 'mercator'] };
		expect(getGlobeness(step as never, 5)).toBe(1);
		expect(getGlobeness(step as never, 6)).toBe(0);
		const interpolate = {
			type: ['interpolate', ['linear'], ['zoom'], 2, 'mercator', 4, 'vertical-perspective'],
		};
		expect(getGlobeness(interpolate as never, 3)).toBeCloseTo(0.5);
	});
});

describe('Projection', () => {
	test('mercator matches the flat projection', () => {
		const p = new Projection({ width: 800, height: 600, center: [13.4, 52.5], zoom: 10 });
		expect(p.isGlobe).toBe(false);
		const [cx, cy] = mercator(13.4, 52.5);
		const [mx, my] = mercator(13.5, 52.4);
		const point = p.project(mx, my);
		expect(point.x).toBeCloseTo((mx - cx) * 512 * 1024 + 400, 6);
		expect(point.y).toBeCloseTo((my - cy) * 512 * 1024 + 300, 6);
	});

	test('globe matches MapLibre’s map.project()', () => {
		// Reference values from MapLibre GL JS 6.10 (globe projection, 800×600, zoom 10).
		const p = new Projection({
			width: 800,
			height: 600,
			center: [139.692, 35.69],
			zoom: 10,
			globeness: 1,
		});
		const cases: [number, number, number, number][] = [
			[139.692, 35.69, 400, 300],
			[139.9, 35.8, 702.2896044269569, 102.574625841179],
			[139.4, 35.5, -25.580315209038584, 639.5148661317205],
			[135, 30, -3573.7621889785464, 5766.587320395815],
		];
		for (const [lng, lat, x, y] of cases) {
			const point = p.project(...mercator(lng, lat));
			expect(point.x).toBeCloseTo(x, 5);
			expect(point.y).toBeCloseTo(y, 5);
		}
	});

	test('the silhouette of the globe', () => {
		const p = new Projection({ width: 800, height: 600, center: [10, 20], zoom: 1, globeness: 1 });
		const circle = p.clipCircle!;
		expect(circle.x).toBe(400);
		expect(circle.y).toBe(300);
		// Radius r = 1024 / (2π·cos 20°) at a camera distance of d = 900: d·r / √((d+r)² − r²)
		expect(circle.radius).toBeCloseTo(147.3, 1);
		// Mercator and the transition do not clip.
		expect(new Projection({ width: 8, height: 6, center: [0, 0], zoom: 1 }).clipCircle).toBe(
			undefined,
		);
	});

	test('toSphere and fromSphere are inverse', () => {
		const p = new Projection({ width: 800, height: 600, center: [10, 20], zoom: 1, globeness: 1 });
		const [mx, my] = mercator(-40, 55);
		const [x, y] = p.fromSphere(p.toSphere(mx, my));
		expect(x).toBeCloseTo(mx, 9);
		expect(y).toBeCloseTo(my, 9);
	});

	test('the four zoom 1 tiles cover the globe', () => {
		const p = new Projection({ width: 800, height: 600, center: [10, 20], zoom: 1, globeness: 1 });
		const { x, y, radius } = p.clipCircle!;
		let area = 0;
		for (const [tx, ty] of [
			[0, 0],
			[0.5, 0],
			[0, 0.5],
			[0.5, 0.5],
		] as const) {
			// Each tile as one polygon, in vector tile winding (clockwise on screen).
			const rings = p.projectGeometry('Polygon', [
				[
					[tx, ty],
					[tx + 0.5, ty],
					[tx + 0.5, ty + 0.5],
					[tx, ty + 0.5],
					[tx, ty],
				],
			]);
			for (const ring of rings) {
				for (const point of ring) {
					expect(Math.hypot(point.x - x, point.y - y)).toBeLessThanOrEqual(radius + 0.01);
				}
				area += polygonArea(ring);
			}
		}
		// Only the pole caps beyond ±85° are missing.
		expect(area).toBeGreaterThan(0.95 * Math.PI * radius * radius);
		expect(area).toBeLessThanOrEqual(Math.PI * radius * radius);
	});

	test('a polygon on the far side disappears', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		const ring: [number, number][] = [
			mercator(170, 10),
			mercator(175, 10),
			mercator(175, 5),
			mercator(170, 5),
		];
		expect(p.projectGeometry('Polygon', [ring])).toEqual([]);
	});

	test('a ring leaving and re-entering the visible side is reconnected along the silhouette', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		// A clockwise (on screen) band along the equator, reaching around the back of the globe
		// on both sides: it has to become one ring covering the visible part of the band.
		const ring: [number, number][] = [
			mercator(-120, 10),
			mercator(120, 10),
			mercator(120, -10),
			mercator(-120, -10),
			mercator(-120, 10),
		];
		const rings = p.projectGeometry('Polygon', [ring]);
		expect(rings).toHaveLength(1);
		const area = polygonArea(rings[0]!);
		expect(area).toBeGreaterThan(0);
		expect(area).toBeLessThan(Math.PI * p.clipCircle!.radius ** 2 * 0.5);
	});

	test('lines are cut at the horizon', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		const parts = p.projectGeometry('LineString', [
			[mercator(-170, 0), mercator(0, 0), mercator(170, 0)],
		]);
		expect(parts).toHaveLength(1);
		const { x, radius } = p.clipCircle!;
		const xs = parts[0]!.map((point) => point.x);
		expect(Math.min(...xs)).toBeCloseTo(x - radius, 1);
		expect(Math.max(...xs)).toBeCloseTo(x + radius, 1);
	});

	test('points on the far side are dropped', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		const points = p.projectGeometry('Point', [[mercator(0, 0)], [mercator(180, 0)]]);
		expect(points).toHaveLength(1);
		expect(points[0]![0]!.x).toBeCloseTo(400, 6);
	});

	test('coveringTiles finds the tiles on screen, even when zoomed in', () => {
		const p = new Projection({
			width: 800,
			height: 600,
			center: [139.692, 35.69],
			zoom: 10,
			globeness: 1,
		});
		const tiles = p.coveringTiles(10);
		const [mx, my] = mercator(139.692, 35.69);
		expect(tiles).toContainEqual({ x: Math.floor(mx * 1024), y: Math.floor(my * 1024), z: 10 });
		expect(tiles.length).toBeGreaterThanOrEqual(4);
		expect(tiles.length).toBeLessThanOrEqual(9);
	});

	test('isTileFullyVisible tells tiles crossing the horizon apart', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		// Around the map center (lng 0, lat 0) …
		expect(p.isTileFullyVisible({ x: 8, y: 7, z: 4 })).toBe(true);
		// … at the edge of the globe (lng -90 … -67.5) …
		expect(p.isTileFullyVisible({ x: 4, y: 7, z: 4 })).toBe(false);
		// … and mercator never clips.
		const flat = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1 });
		expect(flat.isTileFullyVisible({ x: 0, y: 0, z: 1 })).toBe(true);
	});

	test('coveringTiles skips the far side of the globe', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		const tiles = p.coveringTiles(3);
		expect(tiles.length).toBeGreaterThan(0);
		// Tiles around the antimeridian (x = 0 and x = 7) are behind the globe.
		expect(tiles.some((t) => t.x === 0 || t.x === 7)).toBe(false);
	});

	test('rasterTriangles meet their projected corners exactly', () => {
		const p = new Projection({ width: 800, height: 600, center: [0, 0], zoom: 1, globeness: 1 });
		const tile = { x: 1, y: 1, z: 1 };
		const triangles = p.rasterTriangles(tile);
		expect(triangles.length).toBeGreaterThan(2);
		expect(triangles.length % 2).toBe(0);
		for (const { source, target } of triangles) {
			for (let k = 0; k < 3; k++) {
				const [u, v] = source[k]!;
				const mx = (tile.x + u) / 2;
				const my = (tile.y + v) / 2;
				const v3 = p.toSphere(mx, my);
				if (!p.isVisible(v3)) continue; // corners behind the horizon are pulled onto it
				const point = p.project(mx, my, v3);
				expect(target[k]![0]).toBeCloseTo(point.x, 9);
				expect(target[k]![1]).toBeCloseTo(point.y, 9);
			}
		}
		// The corner at lng 0, lat 0 (tile units 0,0 of tile 1/1/1) is the screen center.
		const first = triangles.find(({ source }) => source[0][0] === 0 && source[0][1] === 0)!;
		expect(first.target[0][0]).toBeCloseTo(400, 6);
		expect(first.target[0][1]).toBeCloseTo(300, 6);
	});
});

describe('Projection.unproject', () => {
	/** A grid of screen positions across the image, corners included. */
	function grid(p: Projection): [number, number][] {
		const points: [number, number][] = [];
		for (let i = 0; i <= 6; i++) {
			for (let j = 0; j <= 4; j++) points.push([(p.width * i) / 6, (p.height * j) / 4]);
		}
		return points;
	}

	test.each([
		['mercator', new Projection({ width: 800, height: 600, center: [13.4, 52.5], zoom: 10 })],
		[
			'the globe',
			new Projection({ width: 800, height: 600, center: [10, 20], zoom: 3, globeness: 1 }),
		],
		[
			'the transition',
			new Projection({
				width: 800,
				height: 600,
				center: [139.7, 35.7],
				zoom: 11.5,
				globeness: 0.5,
			}),
		],
	])('is the inverse of project on %s', (_name, p) => {
		const circle = p.clipCircle;
		for (const [x, y] of grid(p)) {
			const m = p.unproject(x, y);
			// Next to the globe (the corners, at zoom 3) there is no map.
			if (circle && Math.hypot(x - circle.x, y - circle.y) > circle.radius) {
				expect(m).toBeUndefined();
				continue;
			}
			if (!m) throw new Error(`no map at ${String(x)}, ${String(y)}`);
			const back = p.project(m[0], m[1]);
			expect(back.x).toBeCloseTo(x, 5);
			expect(back.y).toBeCloseTo(y, 5);
		}
	});

	test('finds nothing next to the globe, and the front side on it', () => {
		const p = new Projection({ width: 800, height: 600, center: [10, 20], zoom: 1, globeness: 1 });
		const circle = p.clipCircle!;
		expect(p.unproject(circle.x + circle.radius + 2, circle.y)).toBeUndefined();
		expect(p.unproject(0, 0)).toBeUndefined();

		const inside = p.unproject(circle.x + circle.radius * 0.9, circle.y);
		if (!inside) throw new Error('expected a point on the globe');
		expect(p.isVisible(p.toSphere(inside[0], inside[1]))).toBe(true);

		// The center of the screen is the center of the view.
		const [mx, my] = p.unproject(400, 300)!;
		const [cx, cy] = mercator(10, 20);
		expect(mx).toBeCloseTo(cx, 9);
		expect(my).toBeCloseTo(cy, 9);
	});

	test('finds nothing beyond the poles of the mercator map', () => {
		const p = new Projection({ width: 512, height: 2048, center: [0, 0], zoom: 0 });
		expect(p.unproject(256, 1024)).toBeDefined();
		expect(p.unproject(256, 5)).toBeUndefined();
		expect(p.unproject(256, 2043)).toBeUndefined();
	});

	test('wraps the mercator map east-west', () => {
		const p = new Projection({ width: 2048, height: 512, center: [170, 0], zoom: 0 });
		// The image is four worlds wide; each point is shown four times.
		const [mx] = p.unproject(2000, 256)!;
		expect(mx).toBeGreaterThanOrEqual(0);
		expect(mx).toBeLessThan(1);
		// project gives the copy nearest the center: a whole number of worlds away.
		const worlds = (2000 - p.project(mx, 0.5).x) / p.worldSize;
		expect(worlds).toBeCloseTo(Math.round(worlds), 9);
	});
});

describe('Projection with a bearing', () => {
	const at = (bearing: number, globeness = 0) =>
		new Projection({ width: 200, height: 100, center: [0, 0], zoom: 2, bearing, globeness });
	const round = (p: { x: number; y: number }) => [
		Math.round(p.x * 100) / 100,
		Math.round(p.y * 100) / 100,
	];

	test('turns the map around the center: at 90°, east is up', () => {
		const north = at(0);
		const east = north.project(0.5 + 0.01, 0.5); // a little east of the center
		expect(round(east)).toEqual([round(east)[0], 50]);
		const turned = at(90).project(0.5 + 0.01, 0.5);
		const distance = east.x - 100;
		expect(round(turned)).toEqual([100, Math.round((50 - distance) * 100) / 100]);
	});

	test('unprojects what it projects, on the flat map and on the globe', () => {
		for (const globeness of [0, 1, 0.5]) {
			const projection = at(33, globeness);
			const p = projection.project(0.51, 0.49);
			const [mx, my] = projection.unproject(p.x, p.y)!;
			expect(mx).toBeCloseTo(0.51, 6);
			expect(my).toBeCloseTo(0.49, 6);
		}
	});

	test('rotate and unrotate are opposites, and keep the center', () => {
		const projection = at(-60);
		const p = projection.rotate(170, 20);
		expect(projection.unrotate(p.x, p.y).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([170, 20]);
		expect(round(projection.rotate(100, 50))).toEqual([100, 50]);
	});

	test('covers the turned image with a larger north-up area', () => {
		expect(at(0).coveredSize).toEqual({ width: 200, height: 100 });
		const { width, height } = at(90).coveredSize;
		expect([Math.round(width), Math.round(height)]).toEqual([100, 200]);
		const diagonal = at(45).coveredSize;
		expect(Math.round(diagonal.width)).toBe(Math.round(300 / Math.SQRT2));
	});

	test('finds the tiles of a turned globe', () => {
		const globe = new Projection({
			width: 800,
			height: 200,
			center: [0, 0],
			zoom: 3,
			globeness: 1,
			bearing: 90,
		});
		// A wide image turned by 90° shows a tall strip of the world: more tiles north–south.
		const tiles = globe.coveringTiles(3);
		const ys = new Set(tiles.map((t) => t.y));
		const xs = new Set(tiles.map((t) => t.x));
		expect(ys.size).toBeGreaterThan(xs.size);
	});
});

describe('mercatorToLonLat', () => {
	test.each([
		[0, 0],
		[13.4, 52.52],
		[-122.4, 37.8],
		[179.9, -85],
	])('inverts getProject2Pixel for %s, %s', (lon, lat) => {
		const [mx, my] = mercator(lon, lat);
		const [lon2, lat2] = mercatorToLonLat(mx, my);
		expect(lon2).toBeCloseTo(lon, 9);
		expect(lat2).toBeCloseTo(lat, 9);
	});
});
