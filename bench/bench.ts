/**
 * Measures how long rendering takes, per scenario and case (see `CASE_DESCRIPTIONS`).
 *
 *   npm run bench                                  # the default scenarios, every case
 *   npm run bench -- --scenarios all --runs 20
 *   npm run bench -- --cases svg-warm,png-warm
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
import {
	CASE_DESCRIPTIONS,
	CASES,
	cases,
	DEFAULT_SCENARIOS,
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
}

interface Report {
	date: string;
	commit: string;
	node: string;
	platform: string;
	cpu: string;
	runs: number;
	results: Result[];
}

/** Differences of the median below this are shown, but not marked as a change. */
const NOTABLE_CHANGE = 0.05;

const { values: args } = parseArgs({
	options: {
		scenarios: { type: 'string' },
		cases: { type: 'string' },
		runs: { type: 'string', default: '10' },
		warmup: { type: 'string', default: '2' },
		json: { type: 'string' },
		compare: { type: 'string' },
	},
});

const ids =
	args.scenarios === 'all' ? scenarioIds() : (args.scenarios?.split(',') ?? DEFAULT_SCENARIOS);
const caseNames = (args.cases?.split(',') ?? CASES) as CaseName[];
const badCase = caseNames.find((name) => !CASES.includes(name));
if (badCase) throw new Error(`Unknown case ${badCase}. Known: ${CASES.join(', ')}`);
const runs = positiveInteger(args.runs, 'runs');
const warmup = positiveInteger(args.warmup, 'warmup');
const baseline = args.compare
	? (JSON.parse(readFileSync(args.compare, 'utf8')) as Report)
	: undefined;

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
		let bytes = 0;
		for (let i = 0; i < warmup; i++) bytes = await c.run();
		const times: number[] = [];
		for (let i = 0; i < runs; i++) {
			// Collect garbage between runs, not during them.
			gc?.();
			const start = performance.now();
			bytes = await c.run();
			times.push(performance.now() - start);
		}
		const result = { scenario: scenario.id, case: c.name, bytes, ...statistics(times) };
		results.push(result);
		console.log(formatResult(result, baseline));
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

function statistics(times: number[]): Omit<Result, 'scenario' | 'case' | 'bytes'> {
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
