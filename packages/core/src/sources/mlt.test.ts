import { describe, expect, test } from 'vitest';
import { encodeTile, type Layer } from '@maplibre/mlt';
import { decodeMLT } from './mlt.js';

function encode(layers: Layer[]): ArrayBuffer {
	const tile = encodeTile(layers);
	return tile.buffer.slice(tile.byteOffset, tile.byteOffset + tile.byteLength) as ArrayBuffer;
}

describe('decodeMLT', () => {
	test('reads layers with their extent and features', () => {
		const layers = decodeMLT(
			encode([
				{
					name: 'places',
					extent: 512,
					features: [
						{ id: 7, geometry: { type: 'Point', coordinates: [10, 20] }, properties: { n: 'a' } },
						{
							id: 8,
							geometry: {
								type: 'MultiPoint',
								coordinates: [
									[1, 2],
									[3, 4],
								],
							},
							properties: { n: 'b' },
						},
					],
				},
				{
					name: 'roads',
					features: [
						{
							id: 1,
							geometry: {
								type: 'LineString',
								coordinates: [
									[0, 0],
									[100, 50],
								],
							},
						},
					],
				},
			]),
		);
		expect(Object.keys(layers)).toEqual(['places', 'roads']);

		const places = layers.places!;
		expect([places.length, places.extent]).toEqual([2, 512]);
		const point = places.feature(0);
		expect([point.type, point.id, point.properties]).toEqual([1, 7, { n: 'a' }]);
		expect(point.loadGeometry()).toEqual([[{ x: 10, y: 20 }]]);
		const multiPoint = places.feature(1);
		expect(multiPoint.type).toBe(1);
		expect(multiPoint.loadGeometry()).toEqual([[{ x: 1, y: 2 }], [{ x: 3, y: 4 }]]);

		const road = layers.roads!.feature(0);
		expect([road.type, layers.roads!.extent]).toEqual([2, 4096]);
		expect(road.loadGeometry()).toEqual([
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 50 },
			],
		]);
	});

	test('reads polygons as rings, closed as in an MVT', () => {
		const layers = decodeMLT(
			encode([
				{
					name: 'areas',
					features: [
						{
							id: 1,
							geometry: {
								type: 'Polygon',
								coordinates: [
									[
										[0, 0],
										[100, 0],
										[100, 100],
										[0, 100],
									],
								],
							},
						},
					],
				},
			]),
		);
		const polygon = layers.areas!.feature(0);
		expect(polygon.type).toBe(3);
		const [ring] = polygon.loadGeometry();
		expect(ring![0]).toEqual({ x: 0, y: 0 });
		expect(ring!.at(-1)).toEqual({ x: 0, y: 0 });
	});

	test('gives no id to a feature without one', () => {
		const layers = decodeMLT(
			encode([{ name: 'l', features: [{ geometry: { type: 'Point', coordinates: [1, 1] } }] }]),
		);
		expect(layers.l!.feature(0).id).toBeUndefined();
	});
});
