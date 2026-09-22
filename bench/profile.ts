/**
 * Records a CPU profile of rendering one scenario, to see where the time goes.
 *
 *   npm run profile -- berlin-vector              # svg-cold, 5 runs
 *   npm run profile -- berlin-satellite --case png-warm --runs 10
 *
 * Only the measured runs are profiled, not the preparation. Open the written
 * `.cpuprofile` in Chrome DevTools (Performance tab → "Load profile") or drop it on
 * https://www.speedscope.app for a flame graph. When reading it:
 *
 * - Time spent in `@napi-rs/canvas` (Skia drawing, PNG encoding) shows up under the name
 *   of one of its native classes, e.g. `FontKey`; the caller tells what it really is.
 * - `post` from `node:inspector` is the profiler itself.
 * - The sources run through tsx, which puts each file on one line: functions and files
 *   are right, line numbers are not.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CASES, cases, prepare, type CaseName } from './fixtures.js';

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		case: { type: 'string', default: 'svg-cold' },
		runs: { type: 'string', default: '5' },
		interval: { type: 'string', default: '100' },
	},
});

const id = positionals[0];
if (!id || positionals.length > 1) throw new Error('Name one scenario, e.g. berlin-vector');
const caseName = args.case as CaseName;
if (!CASES.includes(caseName))
	throw new Error(`Unknown case ${caseName}. Known: ${CASES.join(', ')}`);
const runs = Number(args.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');

console.log(`Preparing ${id} …`);
const [scenario] = await prepare([id]);
const c = cases(scenario!).find((c) => c.name === caseName)!;
await c.setup();
await c.run();

const session = new Session();
session.connect();
await session.post('Profiler.enable');
// In microseconds. The default (1000) misses most of a render's short functions.
await session.post('Profiler.setSamplingInterval', { interval: Number(args.interval) });
await session.post('Profiler.start');
const start = performance.now();
for (let i = 0; i < runs; i++) await c.run();
const elapsed = performance.now() - start;
const { profile } = await session.post('Profiler.stop');
session.disconnect();

const dir = resolve(import.meta.dirname, 'output');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `${id}.${caseName}.cpuprofile`);
writeFileSync(file, JSON.stringify(profile));
console.log(`${String(runs)} × ${caseName}: ${(elapsed / runs).toFixed(1)} ms each`);
console.log(`Profile: ${file}`);
