import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classify, LAYER_FUNCTIONS, OTHER, RULES } from './steps.js';

const repo = resolve(import.meta.dirname, '..');
const url = (file: string): string => `file://${resolve(repo, 'packages', file)}`;
const frame = (functionName: string, file: string) => ({ functionName, url: url(file) });
const RENDER = 'core/src/pipeline/render.ts';
const LAYER = 'core/src/pipeline/layers/layer.ts';
const FILL = 'core/src/pipeline/layers/fill.ts';
const LINE = 'core/src/pipeline/layers/line.ts';

/** Whether `file` defines a function or method called `name`. */
function defines(file: string, name: string): boolean {
	const source = readFileSync(resolve(repo, 'packages', file), 'utf8');
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`(function\\s+${escaped}\\s*[<(])|(^\\s*(public |private |protected |static |async )*${escaped}\\s*[<(])`,
		'm',
	).test(source);
}

describe('the rules of bench/steps.ts', () => {
	// A renamed or moved function would otherwise silently move its time to "other".
	test.each(RULES.filter((rule) => rule.name !== '').map((rule) => [rule.name, rule.file]))(
		'%s is still defined in %s',
		(name, file) => {
			expect(defines(file, name)).toBe(true);
		},
	);

	test.each(LAYER_FUNCTIONS.map((f) => [f.name, f.file]))(
		'%s is still defined in %s',
		(name, file) => {
			expect(defines(file, name)).toBe(true);
		},
	);
});

describe('classify', () => {
	test('names a per-layer step after the layer function further out', () => {
		const stack = [
			frame('render', RENDER),
			frame('renderFillLayer', FILL),
			frame('getPaint', LAYER),
		];
		expect(classify(stack)).toBe('fill · style');
	});

	test('counts what a step calls to that step', () => {
		const stack = [
			frame('renderLineLayer', LINE),
			frame('filterFeatures', LAYER),
			frame('', LAYER),
			frame('evaluate', '../node_modules/@maplibre/maplibre-gl-style-spec/dist/index.mjs'),
		];
		expect(classify(stack)).toBe('line · filter');
	});

	test('recognizes a draw call without its layer function, as after an await', () => {
		expect(classify([frame('drawRasterTiles', 'core/src/renderer/canvas/renderer.ts')])).toBe(
			'raster · draw',
		);
	});

	test('counts native code to the JS function that called it', () => {
		const stack = [
			frame('toBuffer', 'core/src/renderer/canvas/renderer.ts'),
			{ functionName: 'FontKey', url: '' },
		];
		expect(classify(stack)).toBe('output · encode PNG');
	});

	test('divides features by the innermost library or module', () => {
		const features = frame('getLayerFeatures', 'core/src/sources/features.ts');
		const vector = frame('loadVectorSource', 'core/src/sources/vector.ts');
		expect(classify([features, vector, frame('readFields', '../node_modules/pbf/index.js')])).toBe(
			'features · decode tiles',
		);
		expect(classify([features, vector, frame('clipPolygon', 'core/src/sources/clip.ts')])).toBe(
			'features · clip',
		);
		expect(classify([features, vector])).toBe('features · project & build');
	});

	test('names garbage collection and idle time', () => {
		const root = { functionName: '(root)', url: '' };
		expect(classify([root, { functionName: '(garbage collector)', url: '' }])).toBe(
			'garbage collection',
		);
		expect(classify([root, { functionName: '(idle)', url: '' }])).toBe('waiting (idle)');
	});

	test('leaves the rest as other', () => {
		expect(classify([frame('render', RENDER)])).toBe(OTHER);
		expect(classify([frame('renderFillLayer', FILL)])).toBe('fill · other');
	});
});
