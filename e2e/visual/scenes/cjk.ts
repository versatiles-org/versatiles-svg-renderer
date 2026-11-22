/**
 * Labels in Chinese, Japanese and Korean, one per cell, which MapLibre draws with the browser's
 * fonts rather than the style's glyphs (`localIdeographFontFamily`), and the renderers draw as
 * text: at points, on several lines, mixed with Latin, and along lines. Along a line that runs
 * mostly north to south, and with `text-writing-mode`, MapLibre sets the text vertically.
 *
 * | Chinese along a line      | Chinese                   | Chinese along a steep line |
 * | Japanese                  | Korean                    | Chinese, two lines         |
 * | vertical writing mode     | Japanese and Latin        | Japanese, number, steep    |
 *
 * The lines lie in the corners, away from the tile borders at 0° (see `scripts.ts`).
 *
 * The e2e fonts have no CJK, so all three renders fall back to the machine's: in CI's image
 * WenQuanYi Zen Hei, which Skia rasterizes more coarsely than Chrome, hence the drift.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { gridStyle, type Cell } from './grid.js';
import { scriptCell } from './scripts.js';

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// "Chang'an Avenue"
	scriptCell({ id: 'cjk-chinese-line', title: 'Chinese along a line', text: '长安街', line: true }),
	// "Beijing"
	scriptCell({ id: 'cjk-chinese', title: 'Chinese', text: '北京市' }),
	scriptCell({
		id: 'cjk-chinese-steep',
		title: 'Chinese along a steep line',
		text: '长安街',
		line: 'steep',
	}),
	// "Tokyo Tower": kanji and katakana, with a long vowel mark
	scriptCell({ id: 'cjk-japanese', title: 'Japanese', text: '東京タワー' }),
	// "Seoul"
	scriptCell({ id: 'cjk-korean', title: 'Korean', text: '서울특별시' }),
	// "National Museum of China", broken between characters
	scriptCell({
		id: 'cjk-chinese-lines',
		title: 'Chinese, two lines',
		text: '中国国家博物馆',
		layout: { 'text-max-width': 4 },
	}),
	// Set vertically in two columns, read from the right.
	scriptCell({
		id: 'cjk-vertical',
		title: 'vertical writing mode',
		text: '中国国家博物馆',
		layout: { 'text-writing-mode': ['vertical'], 'text-max-width': 4 },
	}),
	scriptCell({ id: 'cjk-mixed', title: 'Japanese and Latin', text: '東京 Tokyo' }),
	// "National Route 246": set vertically, the number stands upright, one digit per em.
	scriptCell({
		id: 'cjk-japanese-steep',
		title: 'Japanese with a number, steep line',
		text: '国道246号',
		line: 'steep',
	}),
];

export function cjkStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
