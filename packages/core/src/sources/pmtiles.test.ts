import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import type { FetchFunction } from './fetch.js';
import { isPMTilesUrl, PMTilesProtocol } from './pmtiles.js';

/** An archive of one square (10°–20° E, 10°–20° N) in layer "square", zoom levels 0–2. */
const ARCHIVE = readFileSync(new URL('./__fixtures__/square.pmtiles', import.meta.url));
const ARCHIVE_URL = 'https://example.com/square.pmtiles';

/** Serves {@link ARCHIVE} at {@link ARCHIVE_URL}, with range requests unless `ranges` is false. */
function serveArchive(ranges = true): ReturnType<typeof vi.fn<FetchFunction>> {
	return vi.fn<FetchFunction>((url, init) => {
		if (url !== ARCHIVE_URL) return Promise.resolve(new Response(null, { status: 404 }));
		const range = init?.headers?.Range;
		if (!ranges || range === undefined) return Promise.resolve(new Response(ARCHIVE));
		const [start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!.slice(1).map(Number) as [
			number,
			number,
		];
		return Promise.resolve(new Response(ARCHIVE.subarray(start, end + 1), { status: 206 }));
	});
}

describe('isPMTilesUrl', () => {
	test('recognizes the pmtiles scheme', () => {
		expect(isPMTilesUrl(`pmtiles://${ARCHIVE_URL}`)).toBe(true);
		expect(isPMTilesUrl(ARCHIVE_URL)).toBe(false);
	});
});

describe('PMTilesProtocol', () => {
	test('gives the TileJSON document of an archive, from its header', async () => {
		const protocol = new PMTilesProtocol(serveArchive());
		const response = await protocol.fetch(`pmtiles://${ARCHIVE_URL}`);
		expect(response.ok).toBe(true);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expect(await response.json()).toEqual({
			tiles: [`pmtiles://${ARCHIVE_URL}/{z}/{x}/{y}`],
			minzoom: 0,
			maxzoom: 2,
			bounds: [10, 10, 20, 20],
		});
	});

	test('gives an archive of MLT tiles the encoding "mlt"', async () => {
		const mltArchive = Buffer.from(ARCHIVE);
		mltArchive.writeUInt8(6, 99); // the header's tile type: MLT
		const protocol = new PMTilesProtocol((_url, init) => {
			const [start, end] = /^bytes=(\d+)-(\d+)$/
				.exec(init!.headers!.Range!)!
				.slice(1)
				.map(Number) as [number, number];
			return Promise.resolve(new Response(mltArchive.subarray(start, end + 1), { status: 206 }));
		});
		const tileJSON = await (await protocol.fetch(`pmtiles://${ARCHIVE_URL}`)).json();
		expect(tileJSON).toMatchObject({ encoding: 'mlt' });
	});

	test('reads the archive with range requests', async () => {
		const fetchFn = serveArchive();
		await new PMTilesProtocol(fetchFn).fetch(`pmtiles://${ARCHIVE_URL}`);
		expect(fetchFn).toHaveBeenCalledWith(ARCHIVE_URL, { headers: { Range: 'bytes=0-16383' } });
	});

	test('gives a tile, decompressed, as a vector tile', async () => {
		const protocol = new PMTilesProtocol(serveArchive());
		const response = await protocol.fetch(`pmtiles://${ARCHIVE_URL}/2/2/1`);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/x-protobuf');
		const data = new Uint8Array(await response.arrayBuffer());
		// An MVT starts with a layer (field 3, length-delimited), not with gzip's magic bytes.
		expect(data[0]).toBe(0x1a);
		expect(new TextDecoder().decode(data)).toContain('square');
	});

	test('answers 404 for a tile the archive does not have', async () => {
		const protocol = new PMTilesProtocol(serveArchive());
		expect((await protocol.fetch(`pmtiles://${ARCHIVE_URL}/2/0/0`)).status).toBe(404);
		expect((await protocol.fetch(`pmtiles://${ARCHIVE_URL}/5/0/0`)).status).toBe(404);
	});

	test('also reads an archive from a server that ignores ranges', async () => {
		const protocol = new PMTilesProtocol(serveArchive(false));
		const response = await protocol.fetch(`pmtiles://${ARCHIVE_URL}/2/2/1`);
		expect(new TextDecoder().decode(await response.arrayBuffer())).toContain('square');
	});

	test('reads the header of an archive only once', async () => {
		const fetchFn = serveArchive();
		const protocol = new PMTilesProtocol(fetchFn);
		await protocol.fetch(`pmtiles://${ARCHIVE_URL}`);
		await protocol.fetch(`pmtiles://${ARCHIVE_URL}/2/2/1`);
		await protocol.fetch(`pmtiles://${ARCHIVE_URL}/1/1/0`);
		const headerReads = fetchFn.mock.calls.filter(([, init]) =>
			init?.headers?.Range?.startsWith('bytes=0-'),
		);
		expect(headerReads).toHaveLength(1);
	});

	test('fails for an archive that cannot be loaded, and tries it again next time', async () => {
		const fetchFn = vi.fn<FetchFunction>(() =>
			Promise.resolve(new Response(null, { status: 500 })),
		);
		const protocol = new PMTilesProtocol(fetchFn);
		await expect(protocol.fetch(`pmtiles://${ARCHIVE_URL}`)).rejects.toThrow('status 500');
		fetchFn.mockImplementation(serveArchive());
		expect((await protocol.fetch(`pmtiles://${ARCHIVE_URL}`)).ok).toBe(true);
	});

	test('fails for a file that is not an archive', async () => {
		const protocol = new PMTilesProtocol(() => Promise.resolve(new Response('not an archive')));
		await expect(protocol.fetch(`pmtiles://${ARCHIVE_URL}`)).rejects.toThrow();
	});

	test('clear makes the next request read the header again', async () => {
		const fetchFn = serveArchive();
		const protocol = new PMTilesProtocol(fetchFn);
		await protocol.fetch(`pmtiles://${ARCHIVE_URL}`);
		const calls = fetchFn.mock.calls.length;
		protocol.clear();
		await protocol.fetch(`pmtiles://${ARCHIVE_URL}`);
		expect(fetchFn.mock.calls.length).toBeGreaterThan(calls);
	});

	test('passes other URLs on to fetch, as they are', async () => {
		const response = new Response('ok');
		const fetchFn = vi.fn<FetchFunction>(() => Promise.resolve(response));
		const protocol = new PMTilesProtocol(fetchFn);
		expect(await protocol.fetch('https://example.com/a.json')).toBe(response);
		const init = { headers: { Range: 'bytes=0-1' } };
		await protocol.fetch('https://example.com/b', init);
		expect(fetchFn.mock.calls).toEqual([
			['https://example.com/a.json'],
			['https://example.com/b', init],
		]);
	});
});
