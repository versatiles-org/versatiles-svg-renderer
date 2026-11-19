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

describe('PANEL_CSS colour scheme', () => {
	test('follows the scheme signalled on the map, inside @supports for light-dark()', () => {
		const supports = PANEL_CSS.indexOf('@supports (color: light-dark(#000, #fff))');
		expect(supports).toBeGreaterThan(0);
		// every light-dark() is inside the @supports block, so older browsers keep the light colours
		expect(PANEL_CSS.slice(supports + 40)).toMatch(/light-dark\([^)]/);
		expect(PANEL_CSS.slice(0, supports)).not.toMatch(/light-dark\([^)]/);
		expect(PANEL_CSS).toContain(
			".maplibregl-map[data-color-scheme='dark'] :is(.svg-export-control, .svg-export-panel)",
		);
		expect(PANEL_CSS).toContain(
			".maplibregl-map[data-color-scheme='light'] :is(.svg-export-control, .svg-export-panel)",
		);
	});

	test('reads the shared control variables with fallbacks, and never defines them', () => {
		for (const name of ['bg', 'fg', 'line', 'hover']) {
			expect(PANEL_CSS).toContain(`var(--maplibregl-ctrl-${name}, light-dark(`);
			expect(PANEL_CSS).not.toMatch(new RegExp(`--maplibregl-ctrl-${name}\\s*:`));
		}
	});

	test('draws the icon in the text colour', () => {
		expect(PANEL_CSS).toMatch(/\.svg-export-btn svg \{[^}]*fill: currentColor;/);
	});
});
