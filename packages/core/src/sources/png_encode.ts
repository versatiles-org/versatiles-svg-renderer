/**
 * A PNG file of RGBA pixels, for images that are drawn from a data URI, like the sheets of a
 * sprite. Without compression: its deflate stream holds the pixels in stored blocks, which needs
 * no dependency and runs in browsers too. The file is a little larger than the pixels.
 */

/** The CRC-32 table of PNG chunks, built on first use. */
let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array, start: number, end: number): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** The checksum of a zlib stream. */
function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	// sums of up to 5552 bytes cannot overflow before the modulo
	for (let i = 0; i < bytes.length;) {
		const end = Math.min(i + 5552, bytes.length);
		for (; i < end; i++) {
			a += bytes[i]!;
			b += a;
		}
		a %= 65521;
		b %= 65521;
	}
	return ((b << 16) | a) >>> 0;
}

/** The longest stored deflate block. */
const MAX_BLOCK = 65535;

/** A zlib stream of the bytes in stored deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
	const blocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
	const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
	const view = new DataView(out.buffer);
	// deflate with a 32 KB window, no dictionary, the fastest level
	out[0] = 0x78;
	out[1] = 0x01;
	let at = 2;
	for (let block = 0; block < blocks; block++) {
		const start = block * MAX_BLOCK;
		const length = Math.min(MAX_BLOCK, raw.length - start);
		out[at] = block === blocks - 1 ? 1 : 0;
		view.setUint16(at + 1, length, true);
		view.setUint16(at + 3, ~length & 0xffff, true);
		out.set(raw.subarray(start, start + length), at + 5);
		at += 5 + length;
	}
	view.setUint32(at, adler32(raw));
	return out;
}

/** A chunk of a PNG file: its length, type, data and CRC. */
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
	return out;
}

/**
 * A PNG file of an image of `width` × `height` pixels, given as RGBA, row by row, not
 * premultiplied: as `ImageData` and MapLibre's `map.addImage` have them.
 * @throws If `data` does not hold `width * height` pixels.
 */
export function encodePNG(
	width: number,
	height: number,
	data: Uint8Array | Uint8ClampedArray,
): Uint8Array {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
		throw new Error(
			`An image must have a positive whole width and height, not ${String(width)} × ${String(height)}`,
		);
	}
	if (data.length !== width * height * 4) {
		throw new Error(
			`An image of ${String(width)} × ${String(height)} pixels needs ${String(width * height * 4)} bytes, not ${String(data.length)}`,
		);
	}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	// 8 bits per channel, RGBA, no interlace
	header[8] = 8;
	header[9] = 6;
	// each row starts with its filter: none
	const row = width * 4;
	const raw = new Uint8Array((row + 1) * height);
	for (let y = 0; y < height; y++)
		raw.set(data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
	const parts = [
		new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', zlibStored(raw)),
		chunk('IEND', new Uint8Array(0)),
	];
	const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		png.set(part, at);
		at += part.length;
	}
	return png;
}
