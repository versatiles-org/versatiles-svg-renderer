/**
 * Measures how long rendering takes, per scenario and case (see `CASE_DESCRIPTIONS`), and
 * how that time divides into the steps of a render: loading the features, then per layer
 * type filtering, evaluating the style and drawing, and finally the output. The steps are
 * shown as the average render of all scenarios, per case; `--details` shows them per
 * scenario too.
 *
 * The times come from runs without a profiler. The steps come from CPU profiles of
 * further runs (see `steps.ts`), and their shares are applied to the measured time.
 *
 *   npm run bench                                  # vector and satellite scenarios, warm cases
 *   npm run bench -- --scenarios berlin-vector --details
 *   npm run bench -- --scenarios all --runs 20
 *   npm run bench -- --cases svg-cold,png-cold
 *   npm run bench -- --no-steps                    # only the times, without profiling
 *   npm run bench -- --json bench/output/main.json # save the results …
 *   npm run bench -- --compare bench/output/main.json  # … and compare a later run with them
 *
 * Tiles come from the e2e cache (`e2e/.cache`), fetched once if missing, and are served
 * from memory while measuring. Timings are wall-clock times of whole renders, so close
 * other busy programs and compare runs made on the same machine.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { profileRuns } from './profiler.js';
import { OTHER, stepShares } from './steps.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
	CASE_DESCRIPTIONS,
	CASES,
	cases,
	defaultScenarioIds,
	HEIGHT,
	prepare,
	scenarioIds,
	WIDTH,
	type CaseName,
} from './fixtures.js';

interface Result {
	scenario: string;
	case: CaseName;
	/** Milliseconds, over all measured runs. */
	median: number;
	min: number;
	max: number;
	mean: number;
	/** Standard deviation relative to the mean. */
	cv: number;
	/** Size of the output, in bytes. */
	bytes: number;
	/** Milliseconds per run spent in each step, on average. */
	steps: Record<string, number>;
}

interface Report {
	date: string;
	commit: string;
	node: string;
	platform: string;
	cpu: string;
	/** The size of the rendered image, as "1024x768". Missing in reports from before. */
	size?: string;
	runs: number;
	results: Result[];
}

/** Differences of the median below this are shown, but not marked as a change. */
const NOTABLE_CHANGE = 0.05;
/** The cases measured unless `--cases` names others. */
const DEFAULT_CASES: CaseName[] = ['svg-warm', 'png-warm'];
/** Steps shorter than this (per run) are summed up into one line. */
const MIN_STEP_MS = 0.1;
/**
 * More time than this in no step is reported, as a probably renamed function: a share of
 * the run, and at least this much in absolute time (a render of 0.2 ms spends a large
 * share of it in the render loop itself).
 */
const MAX_OTHER_SHARE = 0.05;
const MAX_OTHER_MS = 1;
/** The step `PNGMapRenderer` reports for `toBuffer`, which `splitEncoding` divides. */
const ENCODE_STEP = 'output · encode PNG';

const { values: args } = parseArgs({
	options: {
		scenarios: { type: 'string' },
		cases: { type: 'string' },
		runs: { type: 'string', default: '10' },
		warmup: { type: 'string', default: '2' },
		json: { type: 'string' },
		compare: { type: 'string' },
		'no-steps': { type: 'boolean', default: false },
		details: { type: 'boolean', default: false },
		'profile-runs': { type: 'string', default: '5' },
	},
});

const ids =
	args.scenarios === 'all' ? scenarioIds() : (args.scenarios?.split(',') ?? defaultScenarioIds());
const caseNames = (args.cases?.split(',') ?? DEFAULT_CASES) as CaseName[];
const badCase = caseNames.find((name) => !CASES.includes(name));
if (badCase) throw new Error(`Unknown case ${badCase}. Known: ${CASES.join(', ')}`);
const runs = positiveInteger(args.runs, 'runs');
const warmup = positiveInteger(args.warmup, 'warmup');
const profileRunCount = positiveInteger(args['profile-runs'], 'profile-runs');
const SIZE = `${String(WIDTH)}x${String(HEIGHT)}`;
const baseline = args.compare
	? (JSON.parse(readFileSync(args.compare, 'utf8')) as Report)
	: undefined;
// Render times grow with the image size, so a baseline of another size compares nothing.
if (baseline && (baseline.size ?? '800x600') !== SIZE) {
	throw new Error(
		`${args.compare ?? ''} was measured at ${baseline.size ?? '800x600'}, this run renders at ${SIZE}`,
	);
}

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) console.warn('Run with --expose-gc (as `npm run bench` does) for steadier timings.');

console.log(`Preparing ${String(ids.length)} scenarios …`);
const scenarios = await prepare(ids);

console.log(
	`\n${String(WIDTH)}×${String(HEIGHT)} px, ${String(warmup)} warm-up and ${String(runs)} measured runs each`,
);
for (const name of caseNames) console.log(`  ${name.padEnd(8)}  ${CASE_DESCRIPTIONS[name]}`);

const results: Result[] = [];
for (const scenario of scenarios) {
	console.log(`\n${scenario.id}`);
	for (const c of cases(scenario).filter((c) => caseNames.includes(c.name))) {
		await c.setup();
		let output: string | Uint8Array = '';
		for (let i = 0; i < warmup; i++) output = await c.run();
		const times: number[] = [];
		for (let i = 0; i < runs; i++) {
			// Collect garbage between runs, not during them.
			gc?.();
			const start = performance.now();
			output = await c.run();
			times.push(performance.now() - start);
		}
		const stats = statistics(times);
		const steps = new Map<string, number>();
		if (!args['no-steps']) {
			gc?.();
			const profile = await profileRuns(c.run, profileRunCount);
			for (const [step, share] of stepShares(profile)) steps.set(step, share * stats.mean);
			if (typeof output !== 'string') await splitEncoding(steps, output);
		}
		const result: Result = {
			scenario: scenario.id,
			case: c.name,
			bytes: typeof output === 'string' ? Buffer.byteLength(output, 'utf8') : output.length,
			...stats,
			steps: Object.fromEntries(steps),
		};
		results.push(result);
		console.log(formatResult(result, baseline));
		if (!args['no-steps'] && args.details) console.log(formatSteps(result.steps, result.mean));
	}
}

if (!args['no-steps']) {
	for (const name of caseNames) {
		const ofCase = results.filter((r) => r.case === name);
		const n = ofCase.length;
		const steps: Record<string, number> = {};
		for (const r of ofCase) {
			for (const [step, ms] of Object.entries(r.steps)) steps[step] = (steps[step] ?? 0) + ms / n;
		}
		const mean = ofCase.reduce((sum, r) => sum + r.mean, 0) / n;
		console.log(
			`\n${name}, average of ${String(n)} scenario${n === 1 ? '' : 's'}: ${mean.toFixed(1)} ms per render`,
		);
		console.log(formatSteps(steps, mean));
	}
}

if (args.json) {
	const report: Report = {
		date: new Date().toISOString(),
		commit:
			git(['rev-parse', '--short', 'HEAD']) + (git(['status', '--porcelain']) ? '+dirty' : ''),
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		cpu: cpus()[0]?.model ?? 'unknown',
		size: SIZE,
		runs,
		results,
	};
	mkdirSync(dirname(args.json), { recursive: true });
	writeFileSync(args.json, JSON.stringify(report, null, '\t') + '\n');
	console.log(`\nSaved to ${args.json}`);
}
if (baseline) {
	console.log(
		`\nCompared with ${args.compare ?? ''} (${baseline.commit}, ${baseline.date.slice(0, 16)})`,
	);
}

function statistics(times: number[]): Omit<Result, 'scenario' | 'case' | 'bytes' | 'steps'> {
	const sorted = [...times].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
	const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
	const variance = times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
	return { median, min: sorted[0]!, max: sorted.at(-1)!, mean, cv: Math.sqrt(variance) / mean };
}

function formatResult(result: Result, base: Report | undefined): string {
	const ms = (t: number): string => `${t.toFixed(1)} ms`;
	let line =
		`  ${result.case.padEnd(8)}  ${ms(result.median).padStart(10)}` +
		`  (${ms(result.min)} – ${ms(result.max)}, ±${(result.cv * 100).toFixed(1)}%)`.padEnd(32) +
		`  ${(result.bytes / 1024).toFixed(0).padStart(6)} KB`;
	const before = base?.results.find(
		(r) => r.scenario === result.scenario && r.case === result.case,
	);
	if (before) {
		const change = result.median / before.median - 1;
		const mark = Math.abs(change) < NOTABLE_CHANGE ? ' ' : change < 0 ? '▼' : '▲';
		line += `   ${mark} ${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}% vs ${ms(before.median)}`;
	}
	return line;
}

/**
 * Splits the PNG encoding step into rasterizing and encoding, in place.
 *
 * The canvas only records what is drawn onto it; the pixels are drawn when they are first
 * needed, which is when the PNG is encoded. So the encoding step also contains the
 * rasterization of the whole map, and every "draw" step of a PNG render only builds and
 * records the paths. Reading the pixels first does not help: the recording is played back
 * on every read. Instead, the encoding alone is measured on a canvas that holds the
 * rendered image as its only content, and the rest counts as rasterizing.
 */
async function splitEncoding(steps: Map<string, number>, png: Uint8Array): Promise<void> {
	const total = steps.get(ENCODE_STEP);
	if (total === undefined) return;
	const image = await loadImage(png);
	const times: number[] = [];
	for (let i = 0; i < 5; i++) {
		const canvas = createCanvas(image.width, image.height);
		canvas.getContext('2d').drawImage(image, 0, 0);
		const start = performance.now();
		canvas.toBuffer('image/png');
		times.push(performance.now() - start);
	}
	const encode = Math.min(total, statistics(times).median);
	steps.delete(ENCODE_STEP);
	steps.set('output · rasterize (est.)', total - encode);
	steps.set('output · encode PNG (est.)', encode);
}

/**
 * The steps, longest first, as milliseconds and share of `total`, the time they add up to.
 * Warns when much of the time is in no step.
 */
function formatSteps(steps: Record<string, number>, total: number): string {
	const entries = Object.entries(steps).sort((a, b) => b[1] - a[1]);
	const shown = entries.filter(([name, ms]) => ms >= MIN_STEP_MS || name === OTHER);
	const small = entries.filter(([name, ms]) => ms < MIN_STEP_MS && name !== OTHER);
	const lines = shown.map(([name, ms]) => formatStep(name, ms, total));
	if (small.length > 0) {
		const ms = small.reduce((sum, [, t]) => sum + t, 0);
		lines.push(formatStep(`${String(small.length)} shorter steps`, ms, total));
	}
	const otherMs = steps[OTHER] ?? 0;
	const other = otherMs / total;
	if (other > MAX_OTHER_SHARE && otherMs > MAX_OTHER_MS) {
		lines.push(
			`      ⚠ ${(other * 100).toFixed(0)}% in no step: a renamed function? See bench/steps.ts`,
		);
	}
	return lines.join('\n');
}

function formatStep(name: string, ms: number, mean: number): string {
	const share = ((ms / mean) * 100).toFixed(0);
	return `      ${name.padEnd(28)} ${ms.toFixed(1).padStart(7)} ms ${share.padStart(4)}%`;
}

function positiveInteger(value: string | undefined, name: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
	return n;
}

function git(argv: string[]): string {
	try {
		return execFileSync('git', argv, { encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}
