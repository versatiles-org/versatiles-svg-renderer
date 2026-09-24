/**
 * The glyphs a style points at (`glyphs`: `…/{fontstack}/{range}.pbf`), as MapLibre GL JS
 * loads them: ranges of 256 characters per font stack, each glyph a signed distance field
 * (SDF) of its shape, drawn at 24 pixels per em, with MapLibre's layout metrics.
 */
import { PbfReader } from 'pbf';
import type { FetchFunction } from './fetch.js';

/** The size glyphs are drawn at in the files, in pixels per em (MapLibre's `ONE_EM`). */
export const GLYPH_EM = 24;

/** The border around each glyph's bitmap, in pixels (MapLibre's `GLYPH_PBF_BORDER`). */
export const GLYPH_BORDER = 3;

/** One glyph of a glyph file: its SDF bitmap and metrics, in pixels at {@link GLYPH_EM}. */
export interface Glyph {
	/** The character's code point. */
	id: number;
	/** The SDF: `(width + 2 × border) × (height + 2 × border)` bytes, row by row. */
	bitmap: Uint8Array;
	width: number;
	height: number;
	left: number;
	top: number;
	advance: number;
}

/** The glyphs of one range of one font stack, by code point. */
export type GlyphRange = Map<number, Glyph>;

/** The first code point of the range `codePoint` is in. */
export function rangeStart(codePoint: number): number {
	return Math.floor(codePoint / 256) * 256;
}

/** The URL of the range starting at `start` of `fontStack`, from the style's `glyphs`. */
export function glyphRangeUrl(template: string, fontStack: string, start: number): string {
	return template
		.replace('{fontstack}', fontStack)
		.replace('{range}', `${String(start)}-${String(start + 255)}`);
}

/** Decodes a glyph file (MapLibre's `glyphs.proto`). */
export function parseGlyphs(buffer: ArrayBuffer): GlyphRange {
	const glyphs: GlyphRange = new Map();
	const pbf = new PbfReader(new Uint8Array(buffer));
	pbf.readFields((tag, _, stack) => {
		if (tag !== 1) return;
		stack.readMessage((tag2, _2, message) => {
			if (tag2 !== 3) return;
			const glyph: Glyph = {
				id: 0,
				bitmap: new Uint8Array(0),
				width: 0,
				height: 0,
				left: 0,
				top: 0,
				advance: 0,
			};
			message.readMessage((field, g, reader) => {
				switch (field) {
					case 1:
						g.id = reader.readVarint();
						break;
					case 2:
						g.bitmap = reader.readBytes();
						break;
					case 3:
						g.width = reader.readVarint();
						break;
					case 4:
						g.height = reader.readVarint();
						break;
					case 5:
						g.left = reader.readSVarint();
						break;
					case 6:
						g.top = reader.readSVarint();
						break;
					case 7:
						g.advance = reader.readVarint();
						break;
				}
			}, glyph);
			glyphs.set(glyph.id, glyph);
		}, undefined);
	}, undefined);
	return glyphs;
}

/**
 * Loads a glyph range. Resolves to `undefined` if it cannot be loaded, e.g. because the
 * font stack has no such range.
 */
export async function loadGlyphRange(
	template: string,
	fontStack: string,
	start: number,
	fetchFn: FetchFunction,
): Promise<GlyphRange | undefined> {
	try {
		const response = await fetchFn(glyphRangeUrl(template, fontStack, start));
		if (!response.ok) return undefined;
		return parseGlyphs(await response.arrayBuffer());
	} catch {
		return undefined;
	}
}
