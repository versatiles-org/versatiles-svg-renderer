import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { decodeMLT } from '../../packages/core/src/sources/mlt.js';
import { mvtToMLT } from './mvt-to-mlt.js';

/** The core's fixture archive: one square (10°–20° E, 10°–20° N) in layer "square". */
const ARCHIVE = readFileSync(
	new URL('../../packages/core/src/sources/__fixtures__/square.pmtiles', import.meta.url),
);

const source: Source = {
	getKey: () => 'square',
	getBytes: (offset, length): Promise<RangeResponse> =>
		Promise.resolve({ data: new Uint8Array(ARCHIVE.subarray(offset, offset + length)).buffer }),
};

describe('mvtToMLT', () => {
	test('keeps the layers, features, properties and geometry of an MVT', async () => {
		const mvt = (await new PMTiles(source).getZxy(2, 2, 1))!.data;
		const mlt = mvtToMLT(new Uint8Array(mvt));
		const expected = new VectorTile(new PbfReader(new Uint8Array(mvt))).layers;
		const actual = decodeMLT(new Uint8Array(mlt).buffer);

		expect(Object.keys(actual)).toEqual(Object.keys(expected));
		for (const [name, layer] of Object.entries(expected)) {
			const converted = actual[name]!;
			expect([converted.length, converted.extent]).toEqual([layer.length, layer.extent]);
			for (let i = 0; i < layer.length; i++) {
				const [a, b] = [layer.feature(i), converted.feature(i)];
				expect([b.type, b.id, b.properties]).toEqual([a.type, a.id, a.properties]);
				expect(b.loadGeometry()).toEqual(
					a.loadGeometry().map((ring) => ring.map(({ x, y }) => ({ x, y }))),
				);
			}
		}
	});
});
