/**
 * What is measured per region, and how a measurement is graded against its baseline.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Region, StyleName } from '../regions.js';
import type { Shots } from './capture.js';
import { folders } from './output.js';

/**
 * The share of pixels that differ, in percent: each renderer against the MapLibre
 * reference, plus the drift between the two renderers (which catches a backend diverging
 * even while both stay near MapLibre).
 */
export interface Metrics {
	svg: number;
	png: number;
	drift: number;
}

export type MetricName = keyof Metrics;
export const METRICS: MetricName[] = ['svg', 'png', 'drift'];

/**
 * pixelmatch's per-pixel color tolerance (YIQ distance, 0..1). Its default of 0.1 is too
 * lenient for vector maps: it rates a missing light background (e.g. rgb(248,244,240)
 * vs. white) as identical, since that distance corresponds to a threshold of ~0.04.
 * Raster imagery keeps the default: the browser and MapLibre resample images slightly
 * differently, so a stricter threshold there only measures resampling noise.
 */
const PIXELMATCH_THRESHOLD: Record<StyleName, number> = {
	vector: 0.03,
	geojson: 0.03,
	features: 0.03,
	symbols: 0.03,
	satellite: 0.1,
};

/** Measures the three renders of `region`, and writes the diff images. */
export function measure(region: Region, shots: Shots): Metrics {
	const threshold = PIXELMATCH_THRESHOLD[region.style];
	const compare = (a: PNG, b: PNG, folder: string): number => {
		const { width, height } = a;
		const diff = new PNG({ width, height });
		const mismatch = pixelmatch(a.data, b.data, diff.data, width, height, { threshold });
		writeFileSync(resolve(folder, `${region.id}.png`), PNG.sync.write(diff));
		return (mismatch / (width * height)) * 100;
	};
	return {
		svg: compare(shots.maplibre, shots.svg, folders.diff),
		png: compare(shots.maplibre, shots.png, folders.diffPng),
		drift: compare(shots.svg, shots.png, folders.drift),
	};
}

// --- Baseline ---

/**
 * The last blessed metrics, by region id. Baselines hold the highest value seen across the
 * environments that run this suite, so the gate passes in all of them; a lower number
 * elsewhere reads as an improvement rather than a failure.
 */
export type Baseline = Record<string, Partial<Metrics>>;

const baselinePath = resolve(import.meta.dirname, '..', 'diff-baseline.json');

/**
 * Reads `diff-baseline.json`. An entry used to be a single number, the SVG-vs-MapLibre
 * diff; those are still read, so the blessed values survive.
 */
export function readBaseline(): Baseline {
	if (!existsSync(baselinePath)) return {};
	const raw = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<
		string,
		number | Partial<Metrics>
	>;
	return Object.fromEntries(
		Object.entries(raw).map(([id, value]) => [
			id,
			typeof value === 'number' ? { svg: value } : value,
		]),
	);
}

/** Writes `diff-baseline.json`, each metric rounded to 0.01. Returns the file's path. */
export function writeBaseline(baseline: Baseline): string {
	const rounded = Object.fromEntries(
		Object.entries(baseline).map(([id, metrics]) => [
			id,
			Object.fromEntries(
				METRICS.filter((name) => metrics[name] !== undefined).map((name) => [
					name,
					Math.round(metrics[name]! * 100) / 100,
				]),
			),
		]),
	);
	writeFileSync(baselinePath, JSON.stringify(rounded, null, '\t') + '\n');
	return baselinePath;
}

// --- Gate ---

/**
 * A change counts only if it clears both a 10% relative move and a 0.1 percentage-point
 * floor.
 *
 * These are deliberately looser than the measurement is precise. The same commit does not
 * produce the same numbers everywhere: `png` and `drift` compare a Skia-rendered image
 * against a Chromium one, so they carry each rasterizer's platform differences, and text
 * is the worst of it — between macOS and Linux the labels region moves by whole
 * percentage points while everything else stays within 0.05. Three environments run this
 * suite (a developer's machine, the CI runner, and the Pages container), and a baseline
 * tight enough to be exact in one of them just fails in the other two.
 */
const REL_TOLERANCE = 0.1;
const ABS_FLOOR = 0.1;

/**
 * The hard ceiling, derived from the baseline rather than maintained by hand: a diff must
 * stay under max(baseline × 1.5, baseline + 0.5%). The backstop above the (stricter)
 * degradation check.
 */
export function ceilingFor(base: number): number {
	return Math.max(base * 1.5, base + 0.5);
}

/** How a measurement compares to its baseline. */
export type Verdict =
	| { kind: 'new' }
	| { kind: 'same'; base: number }
	| { kind: 'better'; base: number }
	| { kind: 'worse'; base: number }
	| { kind: 'over'; base: number; ceiling: number };

/** Grades `value` against `base`, with the same rules for every metric. */
export function gate(value: number, base: number | undefined): Verdict {
	if (base === undefined) return { kind: 'new' };
	const ceiling = ceilingFor(base);
	if (value > ceiling) return { kind: 'over', base, ceiling };
	const delta = value - base;
	if (Math.abs(delta) > Math.max(base * REL_TOLERANCE, ABS_FLOOR)) {
		return { kind: delta > 0 ? 'worse' : 'better', base };
	}
	return { kind: 'same', base };
}

/** Whether a verdict fails the run. */
export function fails(verdict: Verdict): boolean {
	return verdict.kind === 'worse' || verdict.kind === 'over';
}
