/**
 * The pieces an icon is drawn in, as MapLibre GL JS's `getIconQuads`: one for an icon at
 * its own size, or, for an icon stretched to its label (`icon-text-fit`), one per part of
 * the sprite image between its stretch zones (`stretchX`, `stretchY`): the parts between
 * the zones keep their size, and the zones take up the rest.
 */
import type { SpriteEntry } from '../sources/index.js';
import { mapIconAnchor } from './anchors.js';
import type { IconStyle } from './types.js';

/** A rectangle of the sprite image, and where it is drawn, relative to the icon's point. */
export interface IconQuad {
	/** The rectangle in the sprite sheet, in its pixels. */
	source: { x: number; y: number; width: number; height: number };
	/** Where it is drawn, in pixels from the icon's point, before `icon-rotate`. */
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A cut across the image: pixels of fixed parts and of stretch zones before it. */
interface Cut {
	fixed: number;
	stretch: number;
}

export function iconQuads(style: IconStyle, sprite: SpriteEntry): IconQuad[] {
	const { pixelRatio, width: imageWidth, height: imageHeight } = sprite;
	const size = style.size;

	// The icon's box before `icon-size`: fitted to its label, or at the image's size.
	let box: [number, number, number, number];
	if (style.fit) {
		box = sprite.content ? applyTextFit(style.fit, sprite) : style.fit;
	} else {
		const width = imageWidth / pixelRatio;
		const height = imageHeight / pixelRatio;
		const [dx, dy] = mapIconAnchor(style.anchor, width, height);
		const left = style.offset[0] + dx;
		const top = style.offset[1] + dy;
		box = [left, top, left + width, top + height];
	}
	const [iconLeft, iconTop, iconRight, iconBottom] = box;
	const iconWidth = iconRight - iconLeft;
	const iconHeight = iconBottom - iconTop;

	const stretchX = sprite.stretchX ?? [[0, imageWidth]];
	const stretchY = sprite.stretchY ?? [[0, imageHeight]];
	const stretchWidth = sumWithinRange(stretchX, 0, imageWidth);
	const stretchHeight = sumWithinRange(stretchY, 0, imageHeight);
	const fixedWidth = imageWidth - stretchWidth;
	const fixedHeight = imageHeight - stretchHeight;

	// Fitted, the content area (`content`) is what spans the box.
	let stretchOffsetX = 0;
	let stretchContentWidth = stretchWidth;
	let stretchOffsetY = 0;
	let stretchContentHeight = stretchHeight;
	let fixedOffsetX = 0;
	let fixedContentWidth = fixedWidth;
	let fixedOffsetY = 0;
	let fixedContentHeight = fixedHeight;
	if (sprite.content && style.fit) {
		const [x1, y1, x2, y2] = sprite.content;
		stretchOffsetX = sumWithinRange(stretchX, 0, x1);
		stretchOffsetY = sumWithinRange(stretchY, 0, y1);
		stretchContentWidth = sumWithinRange(stretchX, x1, x2);
		stretchContentHeight = sumWithinRange(stretchY, y1, y2);
		fixedOffsetX = x1 - stretchOffsetX;
		fixedOffsetY = y1 - stretchOffsetY;
		fixedContentWidth = x2 - x1 - stretchContentWidth;
		fixedContentHeight = y2 - y1 - stretchContentHeight;
	}

	// The stretched parts scale with `icon-size`, but not below what leaves room for the
	// fixed ones; the fixed parts keep their size.
	const scaleX = Math.max(fixedContentWidth / pixelRatio / iconWidth, size);
	const scaleY = Math.max(fixedContentHeight / pixelRatio / iconHeight, size);
	const position = (
		cut: Cut,
		stretchOffset: number,
		stretchContent: number,
		stretchTotal: number,
		fixedOffset: number,
		fixedContent: number,
		start: number,
		extent: number,
		scale: number,
	): number => {
		const em = (stretchContent > 0 ? (cut.stretch - stretchOffset) / stretchContent : 0) * extent;
		const px =
			cut.fixed -
			fixedOffset -
			(stretchTotal > 0 ? (fixedContent * cut.stretch) / stretchTotal : 0);
		return (start + em) * scale + px / pixelRatio;
	};
	const x = (cut: Cut): number =>
		position(
			cut,
			stretchOffsetX,
			stretchContentWidth,
			stretchWidth,
			fixedOffsetX,
			fixedContentWidth,
			iconLeft,
			iconWidth,
			scaleX,
		);
	const y = (cut: Cut): number =>
		position(
			cut,
			stretchOffsetY,
			stretchContentHeight,
			stretchHeight,
			fixedOffsetY,
			fixedContentHeight,
			iconTop,
			iconHeight,
			scaleY,
		);

	const quad = (left: Cut, top: Cut, right: Cut, bottom: Cut): IconQuad => {
		const x1 = left.stretch + left.fixed;
		const y1 = top.stretch + top.fixed;
		return {
			source: {
				x: sprite.x + x1,
				y: sprite.y + y1,
				width: right.stretch + right.fixed - x1,
				height: bottom.stretch + bottom.fixed - y1,
			},
			left: x(left),
			top: y(top),
			right: x(right),
			bottom: y(bottom),
		};
	};

	if (!style.fit || (!sprite.stretchX && !sprite.stretchY)) {
		return [
			quad(
				{ fixed: 0, stretch: 0 },
				{ fixed: 0, stretch: 0 },
				{ fixed: 0, stretch: imageWidth },
				{ fixed: 0, stretch: imageHeight },
			),
		];
	}
	const xCuts = stretchZonesToCuts(stretchX, fixedWidth, stretchWidth);
	const yCuts = stretchZonesToCuts(stretchY, fixedHeight, stretchHeight);
	const quads: IconQuad[] = [];
	for (let i = 0; i < xCuts.length - 1; i++) {
		for (let j = 0; j < yCuts.length - 1; j++) {
			const piece = quad(xCuts[i]!, yCuts[j]!, xCuts[i + 1]!, yCuts[j + 1]!);
			if (piece.source.width > 0 && piece.source.height > 0) quads.push(piece);
		}
	}
	return quads;
}

/**
 * The box an icon spans fitted to its label (`icon-text-fit`), as MapLibre's
 * `fitIconToText`: `textBox` is the label's box from its point, in pixels; `fit` says which
 * sides follow it, `padding` (`[top, right, bottom, left]`) how far beyond. The icon is
 * centered on the label on the sides that do not follow it; its `anchor` does not apply.
 */
export function fitIconToText(
	style: IconStyle,
	sprite: SpriteEntry,
	textBox: [number, number, number, number],
	fit: 'width' | 'height' | 'both',
	padding: readonly number[],
): [number, number, number, number] {
	const [textLeft, textTop, textRight, textBottom] = textBox;
	const [top, right, bottom, left] = padding;
	const [dx, dy] = style.offset;
	const width = sprite.width / sprite.pixelRatio;
	const height = sprite.height / sprite.pixelRatio;
	const [x1, x2] =
		fit === 'height'
			? [dx + (textLeft + textRight - width) / 2, dx + (textLeft + textRight + width) / 2]
			: [dx + textLeft - left!, dx + textRight + right!];
	const [y1, y2] =
		fit === 'width'
			? [dy + (textTop + textBottom - height) / 2, dy + (textTop + textBottom + height) / 2]
			: [dy + textTop - top!, dy + textBottom + bottom!];
	return [x1, y1, x2, y2];
}

/** The box around all of `quads`, relative to the icon's point, before `icon-rotate`. */
export function quadsBox(quads: IconQuad[]): [number, number, number, number] {
	return [
		Math.min(...quads.map((q) => q.left)),
		Math.min(...quads.map((q) => q.top)),
		Math.max(...quads.map((q) => q.right)),
		Math.max(...quads.map((q) => q.bottom)),
	];
}

/**
 * A fitted box with the content's aspect ratio restored where the image asks for it
 * (`textFitWidth`, `textFitHeight`: `"proportional"`), as MapLibre's `applyTextFit`.
 */
function applyTextFit(
	box: [number, number, number, number],
	sprite: SpriteEntry,
): [number, number, number, number] {
	let [left, top, right, bottom] = box;
	let width = right - left;
	let height = bottom - top;
	const [x1, y1, x2, y2] = sprite.content!;
	const aspectRatio = (x2 - x1) / (y2 - y1);
	const fitWidth = sprite.textFitWidth ?? 'stretchOrShrink';
	const fitHeight = sprite.textFitHeight ?? 'stretchOrShrink';
	if (fitHeight === 'proportional') {
		if (
			(fitWidth === 'stretchOnly' && width / height < aspectRatio) ||
			fitWidth === 'proportional'
		) {
			const newWidth = Math.ceil(height * aspectRatio);
			left *= newWidth / width;
			width = newWidth;
		}
	} else if (fitWidth === 'proportional') {
		if (fitHeight === 'stretchOnly' && aspectRatio !== 0 && width / height > aspectRatio) {
			const newHeight = Math.ceil(width / aspectRatio);
			top *= newHeight / height;
			height = newHeight;
		}
	}
	right = left + width;
	bottom = top + height;
	return [left, top, right, bottom];
}

function sumWithinRange(ranges: [number, number][], min: number, max: number): number {
	let sum = 0;
	for (const [a, b] of ranges) {
		sum += Math.max(min, Math.min(max, b)) - Math.max(min, Math.min(max, a));
	}
	return sum;
}

/** The cuts at the edges of the stretch zones, as MapLibre's `stretchZonesToCuts`. */
function stretchZonesToCuts(
	zones: [number, number][],
	fixedSize: number,
	stretchSize: number,
): Cut[] {
	const cuts: Cut[] = [{ fixed: 0, stretch: 0 }];
	for (const [c1, c2] of zones) {
		const last = cuts[cuts.length - 1]!;
		cuts.push({ fixed: c1 - last.stretch, stretch: last.stretch });
		cuts.push({ fixed: c1 - last.stretch, stretch: last.stretch + (c2 - c1) });
	}
	cuts.push({ fixed: fixedSize, stretch: stretchSize });
	return cuts;
}
