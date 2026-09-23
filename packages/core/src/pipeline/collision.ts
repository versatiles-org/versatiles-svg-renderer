/**
 * Collision detection of labels and icons, as MapLibre GL JS places symbols
 * (`placement.ts`): symbol layers from the top down, and within a layer in the order of its
 * features (by `symbol-sort-key` first). A symbol is shown if its boxes do not overlap any
 * box placed before, and then blocks its own area. The renderers draw what is kept.
 */
import { mapIconAnchor, mapTextAnchor } from '../renderer/anchors.js';
import type { GlyphPlacement, IconStyle, SymbolStyle } from '../renderer/types.js';
import type { SpriteEntry } from '../sources/sprite.js';
import { textWidth } from './text_metrics.js';

/** An axis-aligned box on screen: `[left, top, right, bottom]`. */
export type Box = [number, number, number, number];

/** The height of a line of text, in ems: MapLibre's default `text-line-height`. */
const LINE_HEIGHT = 1.2;

/** How far beyond the image symbols are placed, as MapLibre's viewport padding. */
const VIEWPORT_PADDING = 100;

/** Side length of the cells of the grid index, in pixels. */
const CELL_SIZE = 32;

/** The collision settings of one symbol, from its layer's layout properties. */
export interface CollisionOptions {
	textAllowOverlap: boolean;
	iconAllowOverlap: boolean;
	textIgnorePlacement: boolean;
	iconIgnorePlacement: boolean;
	textOptional: boolean;
	iconOptional: boolean;
}

/** A label, an icon or both at one point, and whether they are shown. */
export interface PlacedSymbol {
	/** The label's area: one box, or one per glyph for a label along a line. */
	textBoxes?: Box[];
	iconBox?: Box;
	options: CollisionOptions;
	showText: boolean;
	showIcon: boolean;
}

/** `box` grown by `padding`: a number, or `[top, right, bottom, left]`. */
function pad(box: Box, padding: number | readonly number[]): Box {
	const [top, right, bottom, left] =
		typeof padding === 'number' ? [padding, padding, padding, padding] : padding;
	return [box[0] - left!, box[1] - top!, box[2] + right!, box[3] + bottom!];
}

/** The bounding box of `box` rotated by `degrees` around `pivot`. */
function rotate(box: Box, degrees: number, pivot: [number, number]): Box {
	if (degrees % 360 === 0) return box;
	const angle = (degrees * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const xs: number[] = [];
	const ys: number[] = [];
	for (const [x, y] of [
		[box[0], box[1]],
		[box[2], box[1]],
		[box[2], box[3]],
		[box[0], box[3]],
	] as const) {
		const dx = x - pivot[0];
		const dy = y - pivot[1];
		xs.push(pivot[0] + dx * cos - dy * sin);
		ys.push(pivot[1] + dx * sin + dy * cos);
	}
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The box a label covers, placed as the renderers draw it (see `mapTextAnchor`): its
 * width measured from Noto Sans, one line high, grown by `text-padding`.
 */
export function textBox(x: number, y: number, style: SymbolStyle, padding: number): Box {
	const width = textWidth(style.text, style.font, style.size);
	const height = style.size * LINE_HEIGHT;
	const [align, baseline] = mapTextAnchor(style.anchor);
	const left =
		x +
		style.offset[0] * style.size -
		(align === 'middle' ? width / 2 : align === 'end' ? width : 0);
	const top =
		y +
		style.offset[1] * style.size -
		(baseline === 'central' ? height / 2 : baseline === 'text-after-edge' ? height : 0);
	const box = rotate([left, top, left + width, top + height], style.rotate, [x, y]);
	return pad(box, padding);
}

/** The box of one glyph of a label along a line, grown by `text-padding`. */
export function glyphBox(
	glyph: GlyphPlacement,
	advance: number,
	size: number,
	padding: number,
): Box {
	const height = size * LINE_HEIGHT;
	const box: Box = [
		glyph.x - advance / 2,
		glyph.y - height / 2,
		glyph.x + advance / 2,
		glyph.y + height / 2,
	];
	return pad(rotate(box, glyph.angle, [glyph.x, glyph.y]), padding);
}

/** The box an icon covers, placed as the renderers draw it, grown by `icon-padding`. */
export function iconBox(
	x: number,
	y: number,
	style: IconStyle,
	sprite: SpriteEntry,
	padding: number | readonly number[],
): Box {
	const scale = style.size / sprite.pixelRatio;
	const width = sprite.width * scale;
	const height = sprite.height * scale;
	const [anchorX, anchorY] = mapIconAnchor(style.anchor, width, height);
	const pivotX = x + style.offset[0] * style.size;
	const pivotY = y + style.offset[1] * style.size;
	const left = pivotX + anchorX;
	const top = pivotY + anchorY;
	const box = rotate([left, top, left + width, top + height], style.rotate, [pivotX, pivotY]);
	return pad(box, padding);
}

/** The boxes placed so far, in a grid of cells for quick lookup. */
export class CollisionIndex {
	readonly #cells = new Map<number, Box[]>();
	readonly #area: Box;

	/** For an image of `width` × `height` pixels. */
	public constructor(width: number, height: number) {
		this.#area = [
			-VIEWPORT_PADDING,
			-VIEWPORT_PADDING,
			width + VIEWPORT_PADDING,
			height + VIEWPORT_PADDING,
		];
	}

	/** Whether `box` lies at least partly within the image (and its padding). */
	public isInView(box: Box): boolean {
		const area = this.#area;
		return box[0] < area[2] && box[2] > area[0] && box[1] < area[3] && box[3] > area[1];
	}

	public collides(box: Box): boolean {
		for (const key of this.#keys(box)) {
			for (const other of this.#cells.get(key) ?? []) {
				if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) {
					return true;
				}
			}
		}
		return false;
	}

	public insert(box: Box): void {
		for (const key of this.#keys(box)) {
			let cell = this.#cells.get(key);
			if (!cell) this.#cells.set(key, (cell = []));
			cell.push(box);
		}
	}

	/** The keys of the cells `box` touches. */
	*#keys(box: Box): Generator<number> {
		const x0 = Math.floor(box[0] / CELL_SIZE);
		const y0 = Math.floor(box[1] / CELL_SIZE);
		const x1 = Math.floor(box[2] / CELL_SIZE);
		const y1 = Math.floor(box[3] / CELL_SIZE);
		for (let y = y0; y <= y1; y++) {
			// Cells are keyed by position; offset so negative cells do not collide with others.
			for (let x = x0; x <= x1; x++) yield (y + 0x8000) * 0x10000 + (x + 0x8000);
		}
	}
}

/**
 * Decides which of `symbols` are shown, in the order given (highest priority first), as
 * MapLibre's `placeLayerBucketPart` does, and records the shown ones in `index`.
 */
export function placeSymbols(symbols: PlacedSymbol[], index: CollisionIndex): void {
	for (const symbol of symbols) {
		const { textBoxes, iconBox, options } = symbol;
		const hasText = textBoxes !== undefined && textBoxes.length > 0;
		const inView =
			(hasText && textBoxes.some((box) => index.isInView(box))) ||
			(iconBox !== undefined && index.isInView(iconBox));
		if (!inView) {
			symbol.showText = false;
			symbol.showIcon = false;
			continue;
		}
		let showText =
			hasText && (options.textAllowOverlap || !textBoxes.some((box) => index.collides(box)));
		let showIcon = iconBox !== undefined && (options.iconAllowOverlap || !index.collides(iconBox));

		// A label with an icon: both are shown, or neither, unless one is optional. An optional
		// label lets the icon stand alone, but not the label without the icon, and vice versa.
		if (hasText && iconBox) {
			if (!options.textOptional && !options.iconOptional) {
				showText = showIcon = showText && showIcon;
			} else if (!options.iconOptional) {
				showText = showText && showIcon;
			} else if (!options.textOptional) {
				showIcon = showIcon && showText;
			}
		}

		if (showText && !options.textIgnorePlacement) for (const box of textBoxes!) index.insert(box);
		if (showIcon && !options.iconIgnorePlacement) index.insert(iconBox!);
		symbol.showText = showText;
		symbol.showIcon = showIcon;
	}
}
