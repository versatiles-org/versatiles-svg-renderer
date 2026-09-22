import { describe, expect, test } from 'vitest';

describe('maplibre exports', () => {
	test('exports SVGExportControl class', async () => {
		const mod = await import('./index.js');
		expect(mod.SVGExportControl).toBeDefined();
		expect(typeof mod.SVGExportControl).toBe('function');
	});

	test('exports renderToSVG function', async () => {
		const mod = await import('./index.js');
		expect(mod.renderToSVG).toBeDefined();
		expect(typeof mod.renderToSVG).toBe('function');
	});

	test('exports the SVGMapRenderer class', async () => {
		const mod = await import('./index.js');
		expect(typeof mod.SVGMapRenderer).toBe('function');
	});
});
