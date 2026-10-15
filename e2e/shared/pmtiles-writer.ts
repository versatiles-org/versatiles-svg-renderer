/**
 * Writes a PMTiles archive (spec version 3) of vector tiles, so a region can draw tiles from
 * an archive: just enough of the format for that, with a root directory only, and neither
 * the directory nor the tiles compressed.
 */
import { zxyToTileId } from 'pmtiles';

export interface ArchiveTile {
	z: number;
	x: number;
	y: number;
	data: Uint8Array;
}

const HEADER_LENGTH = 127;
/** A reader fetches the header and the root directory in one request of this many bytes. */
const FIRST_REQUEST_LENGTH = 16384;
const COMPRESSION_NONE = 1;
const TILE_TYPES = { mvt: 1, mlt: 6 } as const;

/**
 * An archive of `tiles`, uncompressed vector tiles encoded as `encoding`. Its zoom levels
 * and bounds are those of the tiles, as a reader passes them on to the map.
 */
export function writePMTiles(tiles: ArchiveTile[], encoding: 'mvt' | 'mlt' = 'mvt'): Buffer {
	if (tiles.length === 0) throw new Error('An archive needs at least one tile');
	const entries = tiles
		.map((tile) => ({ tile, tileId: zxyToTileId(tile.z, tile.x, tile.y) }))
		.sort((a, b) => a.tileId - b.tileId);

	let offset = 0;
	const directory = encodeDirectory(
		entries.map(({ tile, tileId }) => {
			const entry = { tileId, offset, length: tile.data.byteLength };
			offset += tile.data.byteLength;
			return entry;
		}),
	);
	const metadata = Buffer.from('{}');
	const tileData = Buffer.concat(entries.map(({ tile }) => tile.data));
	if (HEADER_LENGTH + directory.length > FIRST_REQUEST_LENGTH) {
		throw new Error('Too many tiles for a root directory alone');
	}

	const zooms = tiles.map((tile) => tile.z);
	const minZoom = Math.min(...zooms);
	const maxZoom = Math.max(...zooms);
	const [west, south, east, north] = tileBounds(tiles);

	const header = Buffer.alloc(HEADER_LENGTH);
	header.write('PMTiles', 0, 'ascii');
	header.writeUInt8(3, 7);
	const rootOffset = HEADER_LENGTH;
	const metadataOffset = rootOffset + directory.length;
	const tileDataOffset = metadataOffset + metadata.length;
	const uint64s = [
		rootOffset,
		directory.length,
		metadataOffset,
		metadata.length,
		tileDataOffset, // leaf directories: none, where the tile data starts
		0,
		tileDataOffset,
		tileData.length,
		entries.length, // addressed tiles
		entries.length, // tile entries
		entries.length, // tile contents
	];
	uint64s.forEach((value, i) => header.writeBigUInt64LE(BigInt(value), 8 + i * 8));
	header.writeUInt8(1, 96); // clustered: the tiles are in the order of their IDs
	header.writeUInt8(COMPRESSION_NONE, 97);
	header.writeUInt8(COMPRESSION_NONE, 98);
	header.writeUInt8(TILE_TYPES[encoding], 99);
	header.writeUInt8(minZoom, 100);
	header.writeUInt8(maxZoom, 101);
	header.writeInt32LE(Math.round(west * 1e7), 102);
	header.writeInt32LE(Math.round(south * 1e7), 106);
	header.writeInt32LE(Math.round(east * 1e7), 110);
	header.writeInt32LE(Math.round(north * 1e7), 114);
	header.writeUInt8(minZoom, 118);
	header.writeInt32LE(Math.round(((west + east) / 2) * 1e7), 119);
	header.writeInt32LE(Math.round(((south + north) / 2) * 1e7), 123);

	return Buffer.concat([header, directory, metadata, tileData]);
}

/** A directory: the entries' IDs (as deltas), run lengths, lengths and offsets, as varints. */
function encodeDirectory(entries: { tileId: number; offset: number; length: number }[]): Buffer {
	const bytes: number[] = [];
	writeVarint(bytes, entries.length);
	let lastId = 0;
	for (const { tileId } of entries) {
		writeVarint(bytes, tileId - lastId);
		lastId = tileId;
	}
	// Each entry is one tile: a run length of 1.
	entries.forEach(() => {
		writeVarint(bytes, 1);
	});
	for (const { length } of entries) writeVarint(bytes, length);
	entries.forEach(({ offset }, i) => {
		const previous = entries[i - 1];
		// 0: right after the previous tile.
		writeVarint(bytes, previous && offset === previous.offset + previous.length ? 0 : offset + 1);
	});
	return Buffer.from(bytes);
}

function writeVarint(bytes: number[], value: number): void {
	while (value >= 0x80) {
		bytes.push((value % 0x80) | 0x80);
		value = Math.floor(value / 0x80);
	}
	bytes.push(value);
}

/** `[west, south, east, north]` of the area the tiles cover, in degrees. */
function tileBounds(tiles: ArchiveTile[]): [number, number, number, number] {
	let [west, south, east, north] = [180, 90, -180, -90];
	for (const { z, x, y } of tiles) {
		west = Math.min(west, tileLon(x, z));
		east = Math.max(east, tileLon(x + 1, z));
		north = Math.max(north, tileLat(y, z));
		south = Math.min(south, tileLat(y + 1, z));
	}
	return [west, south, east, north];
}

export function tileLon(x: number, z: number): number {
	return (x / 2 ** z) * 360 - 180;
}

export function tileLat(y: number, z: number): number {
	return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}
