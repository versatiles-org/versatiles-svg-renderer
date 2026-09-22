/**
 * Divides a CPU profile of renders into the steps of a render — loading the features,
 * then per layer type filtering, evaluating the style and drawing, and finally the output
 * — by the functions each sample's call stack went through.
 *
 * The renderer contains no timing code for this: the steps are recognized by the names
 * and files of its functions, listed in `RULES`. `steps.test.ts` checks that every one of
 * them still exists, so a renamed function cannot silently move its time to "other".
 */
import type { Profile } from './profiler.js';

/** A function, by its name and the end of its file's path. */
interface FunctionRef {
	name: string;
	file: string;
}

type Rule = FunctionRef & {
	/** The step, or how to name it from the layer type found further out in the stack. */
	step: string | ((layerType: string) => string);
};

/** The function that draws each layer type; being in it tells a sample's layer type. */
export const LAYER_FUNCTIONS: Record<string, string> = {
	renderBackgroundLayer: 'background',
	renderFillLayer: 'fill',
	renderLineLayer: 'line',
	renderRasterLayer: 'raster',
	renderCircleLayer: 'circle',
	renderSymbolLayer: 'symbol',
};
const RENDER_FILE = 'core/src/pipeline/render.ts';

const byLayer = (name: string) => (layerType: string) => `${layerType} · ${name}`;

/**
 * Checked from the outermost frame of a stack inwards: the first frame that matches one
 * decides the step. So time in a function called from a step (an expression evaluated by
 * the filter, Skia drawing a path) counts to that step.
 */
export const RULES: Rule[] = [
	{ name: 'getLayerFeatures', file: 'core/src/sources/index.ts', step: 'features' },
	// Tile loading resumes in these after awaiting a tile, outside getLayerFeatures' stack.
	{ name: 'loadVectorSource', file: 'core/src/sources/vector.ts', step: 'features' },
	{ name: '', file: 'core/src/sources/vector.ts', step: 'features' },
	{ name: 'loadSprite', file: 'core/src/sources/sprite.ts', step: 'sprite' },
	{ name: 'getRasterTiles', file: 'core/src/sources/raster.ts', step: 'raster · tiles' },
	{ name: '', file: 'core/src/sources/raster.ts', step: 'raster · tiles' },
	{ name: 'filterFeatures', file: RENDER_FILE, step: byLayer('filter') },
	{ name: 'evaluateLayer', file: RENDER_FILE, step: byLayer('style') },
	{ name: 'getPaint', file: RENDER_FILE, step: byLayer('style') },
	{ name: 'getLayout', file: RENDER_FILE, step: byLayer('style') },
	// The callbacks that build each feature's style from getPaint and getLayout. (The one
	// in filterFeatures counts as filtering: filterFeatures comes first in its stack.)
	{ name: '', file: RENDER_FILE, step: byLayer('style') },
	...drawRules('core/src/renderer/svg.ts'),
	...drawRules('core/src/renderer/canvas.ts'),
	{ name: 'getString', file: 'core/src/renderer/svg.ts', step: 'output · serialize SVG' },
	{ name: 'toBuffer', file: 'core/src/renderer/canvas.ts', step: 'output · encode PNG' },
];

/** The draw calls name their layer type themselves, since some resume after an await. */
function drawRules(file: string): Rule[] {
	return [
		{ name: 'drawBackgroundFill', file, step: 'background · draw' },
		{ name: 'drawPolygons', file, step: 'fill · draw' },
		{ name: 'drawLineStrings', file, step: 'line · draw' },
		{ name: 'drawCircles', file, step: 'circle · draw' },
		{ name: 'drawIcons', file, step: 'symbol · draw' },
		{ name: 'drawLabels', file, step: 'symbol · draw' },
		{ name: 'drawRasterTiles', file, step: 'raster · draw' },
	];
}

/** Within the features step, the innermost of these frames tells what kind of work it is. */
const FEATURE_PARTS: { file: string; part: string }[] = [
	{ file: '@mapbox/vector-tile/', part: 'features · decode tiles' },
	{ file: '/pbf/', part: 'features · decode tiles' },
	{ file: 'core/src/sources/clip.ts', part: 'features · clip' },
];

/** Where V8 puts time outside of any JS function. */
const V8_NODES: Record<string, string> = {
	'(garbage collector)': 'garbage collection',
	'(idle)': 'waiting (idle)',
	'(program)': 'other',
	'(root)': 'other',
};

/** Samples no rule matches, e.g. the render loop itself. */
export const OTHER = 'other';

/** The share of the profile's time spent in each step, from 0 to 1. */
export function stepShares(profile: Profile): Map<string, number> {
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const parents = new Map<number, number>();
	for (const node of profile.nodes)
		for (const child of node.children ?? []) parents.set(child, node.id);

	// The time until the next sample belongs to a sample, as in DevTools.
	const samples = profile.samples ?? [];
	const deltas = profile.timeDeltas ?? [];
	const time = new Map<number, number>();
	for (let i = 0; i < samples.length; i++) {
		const id = samples[i]!;
		time.set(id, (time.get(id) ?? 0) + (deltas[i + 1] ?? 0));
	}

	const steps = new Map<string, number>();
	let total = 0;
	const cache = new Map<number, string>();
	for (const [id, t] of time) {
		let step = cache.get(id);
		if (step === undefined) {
			const stack: Profile['nodes'][number]['callFrame'][] = [];
			for (let n: number | undefined = id; n !== undefined; n = parents.get(n)) {
				stack.unshift(nodes.get(n)!.callFrame);
			}
			step = classify(stack);
			cache.set(id, step);
		}
		steps.set(step, (steps.get(step) ?? 0) + t);
		total += t;
	}
	for (const [step, t] of steps) steps.set(step, total > 0 ? t / total : 0);
	return steps;
}

/** The step of one call stack, outermost frame first. */
export function classify(stack: { functionName: string; url: string }[]): string {
	const leaf = stack.at(-1);
	if (leaf && leaf.functionName in V8_NODES && stack.length <= 2)
		return V8_NODES[leaf.functionName]!;

	let layerType: string | undefined;
	for (const [i, frame] of stack.entries()) {
		const type = frame.url.endsWith(RENDER_FILE) ? LAYER_FUNCTIONS[frame.functionName] : undefined;
		if (type) layerType = type;

		const rule = RULES.find((r) => r.name === frame.functionName && frame.url.endsWith(r.file));
		if (!rule) continue;
		if (typeof rule.step === 'string') {
			return rule.step === 'features' ? featurePart(stack.slice(i)) : rule.step;
		}
		// A per-layer step outside a layer function cannot happen; say so rather than guess.
		return rule.step(layerType ?? 'unknown layer');
	}
	return layerType ? `${layerType} · other` : OTHER;
}

function featurePart(stack: { url: string }[]): string {
	for (let i = stack.length - 1; i >= 0; i--) {
		const part = FEATURE_PARTS.find((p) => stack[i]!.url.includes(p.file));
		if (part) return part.part;
	}
	return 'features · project & build';
}
