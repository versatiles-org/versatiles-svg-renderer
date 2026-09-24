/**
 * Compares the renderers with MapLibre GL JS, region by region (see `regions.ts`): renders
 * each three ways (`visual/capture.ts`), measures the differences (`visual/compare.ts`),
 * prints one line per region and writes `output/report.html` (`visual/report.ts`).
 *
 * The run fails if a region got worse than its baseline. Environment variables:
 * - `E2E_REGIONS=parity-features,berlin-vector` runs only these regions (by their id);
 * - `UPDATE_BASELINE=1` blesses the measured values instead: all of them, or with
 *   `E2E_REGIONS` only those of the regions run;
 * - `NO_COLOR` prints without colors.
 */
import { installFetchCache } from './fetch-cache.js';
import { regions } from './regions.js';
import { getStyle } from './styles.js';
import { Capture } from './visual/capture.js';
import {
	fails,
	gate,
	measure,
	METRICS,
	readBaseline,
	writeBaseline,
	type Baseline,
	type Verdict,
} from './visual/compare.js';
import { createOutputFolders } from './visual/output.js';
import { writeReport, type Result } from './visual/report.js';

const useColor = !process.env.NO_COLOR;
const paint = (code: number, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s: string): string => paint(31, s);
const green = (s: string): string => paint(32, s);
const dim = (s: string): string => paint(90, s);

/** A metric as the console shows it, colored by its verdict. */
function formatMetric(name: string, value: number, verdict: Verdict): string {
	const text = `${name} ${value.toFixed(2)}%`;
	switch (verdict.kind) {
		case 'new':
			return `${text}${dim(' (no baseline)')}`;
		case 'same':
			return text;
		case 'better':
			return green(text) + green(` ▼ was ${verdict.base.toFixed(2)}%`);
		case 'worse':
			return red(text) + red(` ▲ was ${verdict.base.toFixed(2)}%`);
		case 'over':
			return red(text) + red(` ✗ over ${verdict.ceiling.toFixed(2)}%`);
	}
}

installFetchCache();
createOutputFolders();

const selectedIds = process.env.E2E_REGIONS?.split(',').map((id) => id.trim());
const selectedRegions = selectedIds
	? regions.filter((region) => selectedIds.includes(region.id))
	: regions;
const baseline = readBaseline();

// What the renderers report as not drawn, collected per region: both renderers report the
// same parts of the style, so each warning is printed once, below the region's line.
const warnings = new Set<string>();

console.log('Launching browser...');
const capture = await Capture.launch((message) => warnings.add(message));

const results: Result[] = [];
const measured: Baseline = {};
let failed = false;

for (const region of selectedRegions) {
	const { id } = region;
	let result: Result;
	try {
		const shots = await capture.shots(region, await getStyle(region), (message) => {
			console.log(dim(`  ${id}: ${message} — retrying`));
		});
		const { svgSizeKB, pngSizeKB } = shots;
		result = { region, metrics: measure(region, shots), svgSizeKB, pngSizeKB };
	} catch (error) {
		console.log(red(`  ${id}: render failed — ${String(error)}`));
		failed = true;
		continue;
	}

	const { metrics } = result;
	const parts = METRICS.map((name) => {
		const verdict = gate(metrics[name], baseline[id]?.[name]);
		if (fails(verdict)) failed = true;
		return formatMetric(name, metrics[name], verdict);
	});
	console.log(`  ${id}: ${parts.join('  ')}`);
	for (const warning of warnings) console.log(dim(`    not drawn: ${warning}`));
	warnings.clear();

	results.push(result);
	measured[id] = metrics;
}

await capture.close();

console.log(`\nReport saved to: ${writeReport(results, baseline)}`);

if (process.env.UPDATE_BASELINE) {
	// A run of selected regions updates only their entries.
	const path = writeBaseline(selectedIds ? { ...baseline, ...measured } : measured);
	console.log(`Baseline updated: ${path}`);
} else if (failed) {
	console.log(red('\nE2E comparison failed — see ✗/▲ above (or bless with UPDATE_BASELINE=1).'));
	process.exitCode = 1;
}
