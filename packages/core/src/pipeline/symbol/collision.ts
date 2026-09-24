/**
 * Collision detection of labels and icons, as MapLibre GL JS places symbols
 * (`placement.ts`): symbol layers from the top down, and within a layer in the order of its
 * features (by `symbol-sort-key` first). A symbol is shown if its boxes do not overlap any
 * box placed before, and then blocks its own area. The renderers draw what is kept.
 */
import { mapTextAnchor } from '../../renderer/anchors.js';
import { iconQuads, quadsBox } from '../../renderer/icon_quads.js';
import type { GlyphPlacement, IconStyle, SymbolStyle } from '../../renderer/types.js';
import type { SpriteEntry } from '../../sources/index.js';
import { tableMetrics, textWidth, type FontMetrics } from './text_metrics.js';
import { VIEW_MARGIN } from '../../geometry.js';

/** An axis-aligned box on screen: `[left, top, right, bottom]`. */
export type Box = [number, number, number, number];

/** The height of a line of text, in ems: MapLibre's default `text-line-height`. */
const LINE_HEIGHT = 1.2;

/** How far beyond the image symbols are placed, as MapLibre's viewport padding. */
const VIEWPORT_PADDING = VIEW_MARGIN;

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
	/**
	 * With `text-variable-anchor`: the label's boxes at each place to try, in order, and the
	 * icon's where it is fitted to the label. Placement picks one (`anchor`) and puts its
	 * boxes into `textBoxes` and `iconBox`.
	 */
	anchors?: { textBoxes: Box[]; iconBox?: Box }[];
	/** The one of `anchors` placed, or the first if none could be. */
	anchor?: number;
}

/**
 * The first of `anchors` whose label (and fitted icon) overlaps nothing placed so far, or
 * with `text-allow-overlap`, the first one, as MapLibre GL JS tries them
 * (`placeBoxForVariableAnchors`). `undefined` if none can be placed.
 */
function chooseAnchor(
	anchors: NonNullable<PlacedSymbol['anchors']>,
	options: CollisionOptions,
	index: CollisionIndex,
): number | undefined {
	const iconFits = (box: Box | undefined): boolean =>
		box === undefined || options.iconAllowOverlap || !index.collides(box);
	const found = anchors.findIndex(
		({ textBoxes, iconBox }) => !textBoxes.some((box) => index.collides(box)) && iconFits(iconBox),
	);
	if (found >= 0) return found;
	// Allowed to overlap, the label (and its fitted icon, placed alike) takes the first place.
	return options.textAllowOverlap ? 0 : undefined;
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

/** A label's lines placed around its point, and the box the block covers. */
export interface TextLayout {
	box: Box;
	/** Each line: where it starts, how wide it is, and its middle, before rotation. */
	lineBoxes: { text: string; left: number; width: number; y: number }[];
	/** Only for more than one line (see `SymbolStyle.lines`). */
	lines?: { text: string; x: number; y: number }[];
	justify?: 'left' | 'center' | 'right';
}

/**
 * Places the `lines` of a label around its point `x`, `y` as MapLibre GL JS does: the block
 * of lines `lineHeight` ems apart is anchored by `text-anchor` and moved by `text-offset`,
 * and each line is aligned within it by `justify` (`"auto"` follows the anchor). The box
 * is the block's, before rotation and padding.
 */
export function layoutText(
	x: number,
	y: number,
	style: SymbolStyle,
	lines: string[],
	lineHeight = LINE_HEIGHT,
	justify = 'center',
	metrics: FontMetrics = tableMetrics(style.font),
): TextLayout {
	const spacing = (style.letterSpacing ?? 0) * style.size;
	const widths = lines.map(
		(line) =>
			textWidth(line, metrics, style.size) + spacing * Math.max(0, Array.from(line).length - 1),
	);
	const width = Math.max(0, ...widths);
	const height = style.size * lineHeight * Math.max(1, lines.length);
	const [align, baseline] = mapTextAnchor(style.anchor);
	const left =
		x +
		style.offset[0] * style.size -
		(align === 'middle' ? width / 2 : align === 'end' ? width : 0);
	const top =
		y +
		style.offset[1] * style.size -
		(baseline === 'central' ? height / 2 : baseline === 'text-after-edge' ? height : 0);
	const box: Box = [left, top, left + width, top + height];
	const side =
		justify === 'auto'
			? align === 'start'
				? 'left'
				: align === 'end'
					? 'right'
					: 'center'
			: (justify as 'left' | 'center' | 'right');
	const lineX = side === 'left' ? left : side === 'right' ? left + width : left + width / 2;
	const lineBoxes = lines.map((text, i) => {
		const lineWidth = widths[i]!;
		return {
			text,
			left: side === 'left' ? left : side === 'right' ? lineX - lineWidth : lineX - lineWidth / 2,
			width: lineWidth,
			y: top + (i + 0.5) * style.size * lineHeight,
		};
	});
	if (lines.length <= 1) return { box, lineBoxes };
	return {
		box,
		lineBoxes,
		justify: side,
		lines: lineBoxes.map(({ text, y }) => ({ text, x: lineX, y })),
	};
}

/**
 * The box a label covers, placed as the renderers draw it (see `mapTextAnchor`): its
 * width measured from Noto Sans, one line high, grown by `text-padding`.
 */
export function textBox(
	x: number,
	y: number,
	style: SymbolStyle,
	padding: number,
	metrics: FontMetrics = tableMetrics(style.font),
): Box {
	return paddedBox(
		layoutText(x, y, style, [style.text], LINE_HEIGHT, 'center', metrics).box,
		style,
		x,
		y,
		padding,
	);
}

/** A label's box rotated with it (`text-rotate`, around its point) and grown by `padding`. */
export function paddedBox(
	box: Box,
	style: SymbolStyle,
	x: number,
	y: number,
	padding: number,
): Box {
	return pad(rotate(box, style.rotate, [x, y]), padding);
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
	const [left, top, right, bottom] = quadsBox(iconQuads(style, sprite));
	// As in MapLibre, `icon-rotate` turns the icon, offset included, around its point.
	const box = rotate([x + left, y + top, x + right, y + bottom], style.rotate, [x, y]);
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
		// With several places to try, the label goes to the first that fits.
		let textFits = true;
		if (symbol.anchors && symbol.anchors.length > 0) {
			const chosen = chooseAnchor(symbol.anchors, symbol.options, index);
			textFits = chosen !== undefined;
			symbol.anchor = chosen ?? 0;
			const { textBoxes, iconBox } = symbol.anchors[symbol.anchor]!;
			symbol.textBoxes = textBoxes;
			if (iconBox) symbol.iconBox = iconBox;
		}
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
			hasText &&
			textFits &&
			(options.textAllowOverlap || !textBoxes.some((box) => index.collides(box)));
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
