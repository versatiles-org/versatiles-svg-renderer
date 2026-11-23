/**
 * How the SVG backend writes numbers, coordinates and attributes. Coordinates are kept in
 * hundredths of a pixel (see `roundXY`) and written with `formatNum`: coarser, they would
 * move the edges of thin lines and dashes visibly in a sharp image.
 */
import type { Segment } from '../../layout/index.js';
import type { Color } from '../color.js';

/** The `d` of a `<path>` tracing `chains`, in hundredths of a pixel; `close` closes each one. */
export function segmentsToPath(chains: Segment[], close = false): string {
	let d = '';
	for (const chain of chains) {
		const first = chain[0];
		if (!first) continue;
		d += 'M' + formatNum(first[0]) + ',' + formatNum(first[1]);
		let px = first[0];
		let py = first[1];
		for (let i = 1; i < chain.length; i++) {
			const x = chain[i]![0];
			const y = chain[i]![1];
			const dx = x - px;
			const dy = y - py;
			if (dy === 0) {
				const rel = 'h' + formatNum(dx);
				const abs = 'H' + formatNum(x);
				d += rel.length <= abs.length ? rel : abs;
			} else if (dx === 0) {
				const rel = 'v' + formatNum(dy);
				const abs = 'V' + formatNum(y);
				d += rel.length <= abs.length ? rel : abs;
			} else {
				const rel = 'l' + formatNum(dx) + ',' + formatNum(dy);
				const abs = 'L' + formatNum(x) + ',' + formatNum(y);
				d += rel.length <= abs.length ? rel : abs;
			}
			px = x;
			py = y;
		}
		if (close) d += 'z';
	}
	return d;
}

/** How many units of the coordinates the SVG backend keeps make a pixel. */
export const UNITS_PER_PIXEL = 100;

/** Hundredths of a pixel, as a number of pixels. */
export function formatNum(units: number): string {
	return String(units / UNITS_PER_PIXEL);
}

/** ` name="opacity"`, or nothing for a fully opaque value. */
export function opacityAttr(name: string, opacity: number): string {
	return opacity < 1 ? ` ${name}="${opacity.toFixed(3)}"` : '';
}

export function fillAttr(color: Color): string {
	let attr = `fill="${color.rgb}"`;
	if (color.alpha < 255) attr += ` fill-opacity="${color.opacity.toFixed(3)}"`;
	return attr;
}

export function strokeAttr(color: Color, width: string): string {
	let attr = `stroke="${color.rgb}" stroke-width="${width}"`;
	if (color.alpha < 255) attr += ` stroke-opacity="${color.opacity.toFixed(3)}"`;
	return attr;
}

export function formatScaled(v: number): string {
	return formatNum(Math.round(v * UNITS_PER_PIXEL));
}

/** How far into its dash pattern a line starts, in hundredths of a pixel. */
export function formatDash(v: number): string {
	return (Math.round(v * 100) / 100).toString();
}

export function formatUnit(v: number): string {
	return (Math.round(v * 100000) / 100000).toString();
}

export function formatScale(v: number): string {
	return (Math.round(v * 10000) / 10000).toString();
}

export function roundXY(x: number, y: number): [number, number] {
	return [Math.round(x * UNITS_PER_PIXEL), Math.round(y * UNITS_PER_PIXEL)];
}

export function formatPoint(p: [number, number]): string {
	const [x, y] = roundXY(p[0], p[1]);
	return formatNum(x) + ',' + formatNum(y);
}

export function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
