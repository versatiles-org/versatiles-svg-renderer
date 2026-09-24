import { expect, test } from 'vitest';
import { fontFamily } from './text.js';

test('fontFamily is the font stack with fallbacks', () => {
	expect(fontFamily(['Noto Sans Regular', 'Arial Unicode MS'])).toBe(
		'Noto Sans Regular, Arial Unicode MS, Helvetica, Arial, sans-serif',
	);
});
