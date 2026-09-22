// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { renderChart, sectionOf, sections, SECTIONS } from './chart.js';
import { averageRender, type Report, type Result } from './report.js';

function result(scenario: string, caseName: Result['case'], steps: Record<string, number>): Result {
	const mean = Object.values(steps).reduce((sum, ms) => sum + ms, 0);
	return {
		scenario,
		case: caseName,
		median: mean,
		min: mean,
		max: mean,
		mean,
		cv: 0,
		bytes: 1,
		steps,
	};
}

const SVG_STEPS = {
	'features · decode tiles': 4,
	'features · clip': 8,
	'features · project & build': 12,
	'fill · draw': 11,
	'line · draw': 11,
	'line · filter': 3,
	'symbol · style': 1,
	'garbage collection': 8,
	'output · serialize SVG': 1.5,
	other: 2,
};
const PNG_STEPS = {
	'features · decode tiles': 4,
	'features · clip': 8,
	'features · project & build': 12,
	'fill · draw': 14,
	'line · draw': 10,
	'raster · draw': 1,
	'garbage collection': 4.5,
	'output · rasterize (est.)': 38,
	'output · encode PNG (est.)': 33,
	other: 1.5,
};

function report(overrides: Partial<Report> = {}): Report {
	return {
		date: '2026-09-22T10:00:00.000Z',
		commit: 'abc1234',
		node: 'v24.16.0',
		platform: 'darwin-arm64',
		cpu: 'Apple M4 Pro',
		size: '1024x768',
		runs: 10,
		results: [
			result('a', 'svg-warm', SVG_STEPS),
			result('b', 'svg-warm', { ...SVG_STEPS, 'fill · draw': 21 }),
			result('a', 'png-warm', PNG_STEPS),
			result('b', 'png-warm', PNG_STEPS),
		],
		...overrides,
	};
}

describe('sections', () => {
	test('add up to the average render', () => {
		for (const caseName of ['svg-warm', 'png-warm'] as const) {
			const render = averageRender(report().results, caseName);
			const total = [...sections(render).values()].reduce((sum, ms) => sum + ms, 0);
			expect(total).toBeCloseTo(render.mean, 9);
		}
	});

	test('put the small per-layer steps into "other"', () => {
		const svg = sections(averageRender(report().results, 'svg-warm'));
		expect(svg.get('other')).toBeCloseTo(3 + 1 + 2, 9);
		expect(svg.get('fill')).toBeCloseTo((11 + 21) / 2, 9);
		expect(svg.get('encode')).toBeCloseTo(1.5, 9);
	});

	test('throw on a step without a section, rather than dropping it', () => {
		expect(() => sectionOf('features · something new')).toThrow(/no section for the step/);
		expect(() => sectionOf('Weird Step')).toThrow(/no section/);
	});
});

describe('renderChart', () => {
	const svg = renderChart(report());

	test('is a well-formed SVG document', () => {
		const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
		expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
		expect(doc.documentElement.nodeName).toBe('svg');
	});

	test('labels every section present, with its value', () => {
		const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
		const labels = [...doc.querySelectorAll('tspan.label')].map((t) => t.textContent);
		// Nine sections for PNG; SVG has no rasterizing.
		expect(labels).toHaveLength(SECTIONS.length * 2 - 1);
		expect(labels.filter((l) => l === 'rasterize')).toHaveLength(1);
		expect(svg).toContain('38.0 ms');
		expect(svg).toContain('16.0 ms'); // SVG fill · draw, averaged
	});

	test('shows both totals and what the numbers come from', () => {
		expect(svg).toContain('66.5 ms');
		expect(svg).toContain('126.0 ms');
		expect(svg).toContain('Average warm render of 2 scenarios at 1024×768 px');
		expect(svg).toContain('Apple M4 Pro · Node v24.16.0 · 2026-09-22 · abc1234');
	});

	test('escapes text', () => {
		expect(svg).toContain('project &amp; build');
		expect(svg).not.toMatch(/project & build/);
	});

	test('is the same for the same report', () => {
		expect(renderChart(report())).toBe(svg);
	});

	test('needs the steps', () => {
		const noSteps = report();
		for (const r of noSteps.results) r.steps = {};
		expect(() => renderChart(noSteps)).toThrow(/without --no-steps/);
	});

	test('needs both cases', () => {
		const svgOnly = report();
		svgOnly.results = svgOnly.results.filter((r) => r.case === 'svg-warm');
		expect(() => renderChart(svgOnly)).toThrow(/no results for png-warm/);
	});
});
