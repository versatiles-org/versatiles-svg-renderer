import { PbfWriter } from 'pbf';

/** A glyph for a test glyph file: a filled rectangle, `width` × `height` pixels at 24 px/em. */
export interface TestGlyph {
	id: number;
	width: number;
	height: number;
	left?: number;
	top?: number;
	advance: number;
}

/**
 * The SDF of a filled rectangle inside a 3 px border, as a glyph file stores it: 191 (the
 * edge) on the rectangle's outline, rising inwards and falling outwards by 24 per pixel.
 */
export function rectangleSdf(width: number, height: number): Uint8Array {
	const w = width + 6;
	const h = height + 6;
	const values = new Uint8Array(w * h);
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			// Signed distance from the pixel's center to the rectangle's outline, inside positive.
			const x = i + 0.5 - 3;
			const y = j + 0.5 - 3;
			const inside = Math.min(x, width - x, y, height - y);
			values[j * w + i] = Math.max(0, Math.min(255, Math.round(191.25 + inside * 24)));
		}
	}
	return values;
}

/** A glyph file (MapLibre's `glyphs.proto`) with `glyphs`, each an SDF rectangle. */
export function glyphFile(glyphs: TestGlyph[], name = 'Test Regular'): ArrayBuffer {
	const pbf = new PbfWriter();
	pbf.writeMessage(
		1,
		(_: unknown, stack: PbfWriter) => {
			stack.writeStringField(1, name);
			stack.writeStringField(2, '0-255');
			for (const glyph of glyphs) {
				stack.writeMessage(
					3,
					(__: unknown, message: PbfWriter) => {
						message.writeVarintField(1, glyph.id);
						if (glyph.width > 0)
							message.writeBytesField(2, rectangleSdf(glyph.width, glyph.height));
						message.writeVarintField(3, glyph.width);
						message.writeVarintField(4, glyph.height);
						message.writeSVarintField(5, glyph.left ?? 0);
						message.writeSVarintField(6, glyph.top ?? 0);
						message.writeVarintField(7, glyph.advance);
					},
					undefined,
				);
			}
		},
		undefined,
	);
	const bytes = pbf.finish();
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
