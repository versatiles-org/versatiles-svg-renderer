import type { SpriteAtlas } from '../types.js';
import { arrayBufferToBase64 } from './base64.js';
import { encodePNG } from './png_encode.js';

/**
 * An image that the style uses besides those of its sprite, as MapLibre GL JS takes it with
 * `map.addImage(id, { width, height, data }, { pixelRatio, sdf })`.
 */
export interface StyleImage {
	/** The name that the style uses, e.g. in `icon-image` or `fill-pattern`. No sprite id is put before it. */
	id: string;
	/** Width in pixels. */
	width: number;
	/** Height in pixels. */
	height: number;
	/** The pixels as RGBA, row by row, not premultiplied: `width * height * 4` bytes. */
	data: Uint8Array | Uint8ClampedArray;
	/**
	 * Image pixels per pixel of the map, e.g. `2` for an image drawn at half its size.
	 * @defaultValue `1`
	 */
	pixelRatio?: number;
	/**
	 * Whether the image is a signed distance field, as a sprite image can be: only its alpha
	 * channel counts, and `icon-color` and the icon halo color it.
	 * @defaultValue `false`
	 */
	sdf?: boolean;
}

/**
 * The images in an atlas like the sprite's, each on a sheet of its own. An image that cannot be
 * drawn, e.g. with too few pixels, is left out with a warning.
 */
export function imageAtlas(
	images: readonly StyleImage[],
	warn: (message: string) => void,
): SpriteAtlas {
	const atlas: SpriteAtlas = new Map();
	for (const image of images) {
		const { id, width, height, data, pixelRatio = 1, sdf = false } = image;
		if (atlas.has(id)) {
			warn(`The image "${id}" is given twice in "images": the first one is drawn.`);
			continue;
		}
		if (!(pixelRatio > 0)) {
			warn(`The image "${id}" in "images" has no positive pixelRatio: it is left out.`);
			continue;
		}
		let png: Uint8Array;
		try {
			png = encodePNG(width, height, data);
		} catch (error) {
			warn(`The image "${id}" in "images" is left out: ${(error as Error).message}.`);
			continue;
		}
		const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
		atlas.set(id, {
			width,
			height,
			x: 0,
			y: 0,
			pixelRatio,
			sdf,
			sheetDataUri: `data:image/png;base64,${arrayBufferToBase64(buffer)}`,
			sheetWidth: width,
			sheetHeight: height,
		});
	}
	return atlas;
}

/**
 * The sprite's atlas with the images added, like `map.addImage` in MapLibre GL JS, which fails for
 * an id that the style has already: an image of the sprite keeps its place, with a warning.
 */
export function withImages(
	sprite: SpriteAtlas,
	images: SpriteAtlas,
	warn: (message: string) => void,
): SpriteAtlas {
	if (images.size === 0) return sprite;
	const atlas: SpriteAtlas = new Map(sprite);
	for (const [id, entry] of images) {
		if (atlas.has(id)) {
			warn(`The image "${id}" in "images" is in the sprite too: the sprite's is drawn.`);
			continue;
		}
		atlas.set(id, entry);
	}
	return atlas;
}
