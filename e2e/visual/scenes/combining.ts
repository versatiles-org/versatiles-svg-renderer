/**
 * Labels in scripts whose letters combine, one per cell, which MapLibre draws with the browser's
 * fonts rather than the style's glyphs, and the renderers draw as text: Indic scripts, Thai,
 * Khmer, Myanmar, and Hebrew with its vowel points. Points and lines, laid out with the widths
 * each letter adds to its cluster.
 *
 * | Devanagari along a line   | Devanagari                | Thai along a line         |
 * | Bengali                   | Thai                      | Tamil                     |
 * | Hebrew points, line       | Khmer                     | Myanmar                   |
 *
 * The lines lie in the corners, away from the tile borders at 0° (see `scripts.ts`).
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { gridStyle, type Cell } from './grid.js';
import { scriptCell } from './scripts.js';

/** The scene's cells, row by row. */
export const cells: Cell[] = [
	// "Mahatma Gandhi Road": conjuncts and a reph
	scriptCell({
		id: 'combining-devanagari-line',
		title: 'Devanagari along a line',
		text: 'महात्मा गांधी मार्ग',
		line: true,
	}),
	// "New Delhi": a vowel sign written before its letter
	scriptCell({ id: 'combining-devanagari', title: 'Devanagari', text: 'नई दिल्ली' }),
	// "Sukhumvit Road": vowels above and below
	scriptCell({
		id: 'combining-thai-line',
		title: 'Thai along a line',
		text: 'ถนนสุขุมวิท',
		line: true,
	}),
	// "Dhaka"
	scriptCell({ id: 'combining-bengali', title: 'Bengali', text: 'ঢাকা' }),
	// "Krung Thep Maha Nakhon", Bangkok
	scriptCell({ id: 'combining-thai', title: 'Thai', text: 'กรุงเทพมหานคร' }),
	// "Chennai": two-part vowel signs around their letter
	scriptCell({ id: 'combining-tamil', title: 'Tamil', text: 'சென்னை' }),
	// "Yerushalayim", with its vowel points
	scriptCell({
		id: 'combining-hebrew-points-line',
		title: 'Hebrew with points along a line',
		text: 'יְרוּשָׁלַיִם',
		line: true,
	}),
	// "Phnom Penh": consonants stacked below
	scriptCell({ id: 'combining-khmer', title: 'Khmer', text: 'ភ្នំពេញ' }),
	// "Yangon"
	scriptCell({ id: 'combining-myanmar', title: 'Myanmar', text: 'ရန်ကုန်' }),
];

export function combiningStyle(): StyleSpecification {
	return gridStyle(cells, {
		glyphs: 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf',
	});
}
