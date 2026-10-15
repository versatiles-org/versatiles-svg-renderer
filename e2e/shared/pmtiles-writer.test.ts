import { describe, expect, test } from 'vitest';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { tileLat, tileLon, writePMTiles } from './pmtiles-writer.js';

/** Reads an archive from memory, as the `pmtiles` package reads it from a server. */
class BufferSource implements Source {
	constructor(readonly buffer: Buffer) {}
	getKey(): string {
		return 'memory';
	}
	getBytes(offset: number, length: number): Promise<RangeResponse> {
		const data = this.buffer.subarray(offset, offset + length);
		return Promise.resolve({ data: new Uint8Array(data).buffer });
	}
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

describe('writePMTiles', () => {
	const tiles = [
		{ z: 3, x: 5, y: 2, data: bytes('b') },
		{ z: 3, x: 4, y: 2, data: bytes('a') },
		{ z: 3, x: 4, y: 3, data: bytes('ccc') },
	];
	const archive = new PMTiles(new BufferSource(writePMTiles(tiles)));

	test('writes a header with the zoom levels and bounds of the tiles', async () => {
		const header = await archive.getHeader();
		expect(header).toMatchObject({
			specVersion: 3,
			tileType: 1,
			minZoom: 3,
			maxZoom: 3,
			numAddressedTiles: 3,
		});
		expect(header.minLon).toBeCloseTo(tileLon(4, 3), 6);
		expect(header.maxLon).toBeCloseTo(tileLon(6, 3), 6);
		expect(header.maxLat).toBeCloseTo(tileLat(2, 3), 6);
		expect(header.minLat).toBeCloseTo(tileLat(4, 3), 6);
	});

	test('writes the tiles, which a reader finds', async () => {
		for (const { z, x, y, data } of tiles) {
			const tile = await archive.getZxy(z, x, y);
			expect(new Uint8Array(tile!.data)).toEqual(data);
		}
		expect(await archive.getZxy(3, 0, 0)).toBeUndefined();
	});

	test('writes metadata a reader can parse', async () => {
		expect(await archive.getMetadata()).toEqual({});
	});

	test('refuses to write an empty archive', () => {
		expect(() => writePMTiles([])).toThrow();
	});
});
