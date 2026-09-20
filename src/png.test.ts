import { describe, expect, test, vi } from 'vitest';
import { loadCanvasBackend, renderToPNG } from './png.js';

const minimalStyle = {
	version: 8 as const,
	sources: {},
	layers: [],
};

describe('loadCanvasBackend', () => {
	test('resolves the optional canvas backend', async () => {
		const backend = await loadCanvasBackend();
		expect(typeof backend.createCanvas).toBe('function');
	});

	test('caches the backend across calls', async () => {
		const [first, second] = await Promise.all([loadCanvasBackend(), loadCanvasBackend()]);
		expect(first).toBe(second);
	});

	test('explains how to install the backend when it is missing', async () => {
		vi.resetModules();
		vi.doMock('@napi-rs/canvas', () => {
			throw new Error("Cannot find package '@napi-rs/canvas'");
		});
		const png = await import('./png.js');
		await expect(png.loadCanvasBackend()).rejects.toThrow(/npm install @napi-rs\/canvas/);
		vi.doUnmock('@napi-rs/canvas');
		vi.resetModules();
	});
});

describe('renderToPNG', () => {
	test.each([
		['width', { width: 0 }, 'width must be positive'],
		['height', { height: -1 }, 'height must be positive'],
		['scale', { scale: 0 }, 'scale must be positive'],
	])('rejects a non-positive %s', async (_name, overrides, message) => {
		await expect(renderToPNG({ style: minimalStyle, ...overrides })).rejects.toThrow(message);
	});

	// The canvas renderer itself is not written yet; this pins the seam so the skeleton
	// cannot be mistaken for a working implementation.
	test('reports that rendering is not implemented yet', async () => {
		await expect(renderToPNG({ style: minimalStyle })).rejects.toThrow(/not implemented yet/);
	});
});
