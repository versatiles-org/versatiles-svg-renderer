import { describe, expect, test } from 'vitest';
import { PANEL_CSS } from './panel_css.js';

describe('PANEL_CSS', () => {
	test('is a non-empty string', () => {
		expect(typeof PANEL_CSS).toBe('string');
		expect(PANEL_CSS.length).toBeGreaterThan(0);
	});

	test('contains panel class styles', () => {
		expect(PANEL_CSS).toContain('.svg-export-panel');
	});

	test('contains button styles', () => {
		expect(PANEL_CSS).toContain('.svg-export-btn');
	});

	test('contains preview styles', () => {
		expect(PANEL_CSS).toContain('.preview-container');
	});

	test('contains action button styles', () => {
		expect(PANEL_CSS).toContain('.btn-download');
		expect(PANEL_CSS).toContain('.btn-open');
	});
});
