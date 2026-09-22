/** The results of `npm run bench`, as `--json <file>` saves them, and their averages. */
import type { CaseName } from './fixtures.js';

export interface Result {
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

export interface Report {
	date: string;
	commit: string;
	node: string;
	platform: string;
	cpu: string;
	/** The size of the rendered image, as "1024x768". */
	size: string;
	runs: number;
	results: Result[];
}

/** The average render of one case over all its scenarios. */
export interface AverageRender {
	/** Number of scenarios averaged. */
	scenarios: number;
	/** Milliseconds per render. */
	mean: number;
	/** Milliseconds per render spent in each step. */
	steps: Record<string, number>;
}

export function averageRender(results: Result[], caseName: CaseName): AverageRender {
	const ofCase = results.filter((r) => r.case === caseName);
	const n = ofCase.length;
	const steps: Record<string, number> = {};
	for (const r of ofCase) {
		for (const [step, ms] of Object.entries(r.steps)) steps[step] = (steps[step] ?? 0) + ms / n;
	}
	const mean = n > 0 ? ofCase.reduce((sum, r) => sum + r.mean, 0) / n : 0;
	return { scenarios: n, mean, steps };
}
