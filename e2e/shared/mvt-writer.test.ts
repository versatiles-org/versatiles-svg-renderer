import { describe, expect, test } from 'vitest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { writeMVT } from './mvt-writer.js';

describe('writeMVT', () => {
	test('writes polygons with their properties, which a reader finds', () => {
		const tile = writeMVT('areas', [
			{
				ring: [
					[-100, -100],
					[4196, -100],
					[4196, 4196],
					[-100, 4196],
				],
				properties: { kind: 'sea' },
			},
			{
				ring: [
					[10, 20],
					[30, 20],
					[30, 40],
				],
				properties: { kind: 'land', name: 'island' },
			},
		]);
		const layer = new VectorTile(new PbfReader(tile)).layers.areas!;
		expect([layer.length, layer.extent, layer.version]).toEqual([2, 4096, 2]);

		const sea = layer.feature(0);
		expect([sea.type, sea.properties]).toEqual([3, { kind: 'sea' }]);
		expect(sea.loadGeometry()[0]!.map(({ x, y }) => [x, y])).toEqual([
			[-100, -100],
			[4196, -100],
			[4196, 4196],
			[-100, 4196],
			[-100, -100],
		]);
		const island = layer.feature(1);
		expect(island.properties).toEqual({ kind: 'land', name: 'island' });
		expect(island.loadGeometry()[0]!.map(({ x, y }) => [x, y])).toEqual([
			[10, 20],
			[30, 20],
			[30, 40],
			[10, 20],
		]);
	});
});
