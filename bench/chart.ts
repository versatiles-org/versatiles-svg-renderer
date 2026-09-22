/**
 * Draws a benchmark report as an SVG image for the README: two stacked columns, the
 * average warm render as SVG and as PNG, divided into the steps of a render.
 *
 * The image works where GitHub shows it, as a plain `<img>`: no script, no web fonts, and
 * the dark theme comes from a `prefers-color-scheme` query in its own stylesheet. The same
 * report always gives the same bytes, so a regenerated chart only differs where the
 * numbers do.
 */
import { averageRender, type AverageRender, type Report } from './report.js';

interface Section {
	id: string;
	label: string;
	/** Categorical color slot, in stacking order: adjacent slots are validated as pairs. */
	color: string;
}

/** The sections of a column, from the bottom up, in the order of the render. */
export const SECTIONS: Section[] = [
	{ id: 'decode', label: 'decode tiles', color: 's1' },
	{ id: 'clip', label: 'clip', color: 's2' },
	{ id: 'project', label: 'project & build', color: 's3' },
	{ id: 'fill', label: 'fill · draw', color: 's4' },
	{ id: 'line', label: 'line · draw', color: 's5' },
	{ id: 'gc', label: 'garbage collection', color: 's6' },
	{ id: 'rasterize', label: 'rasterize', color: 's7' },
	{ id: 'encode', label: 'encode / serialize', color: 's8' },
	{ id: 'other', label: 'other', color: 'other' },
];

const EXACT: Record<string, string> = {
	'features · decode tiles': 'decode',
	'features · clip': 'clip',
	'features · project & build': 'project',
	'fill · draw': 'fill',
	'line · draw': 'line',
	'garbage collection': 'gc',
	'output · rasterize (est.)': 'rasterize',
	'output · encode PNG (est.)': 'encode',
	'output · encode PNG': 'encode',
	'output · serialize SVG': 'encode',
	sprite: 'other',
	'waiting (idle)': 'other',
	other: 'other',
};

/**
 * The section a step of `bench/steps.ts` belongs to. The small per-layer steps (filtering,
 * styles, drawing circles, symbols, rasters) go to "other". A step this does not know
 * throws, rather than vanishing from the chart.
 */
export function sectionOf(step: string): string {
	const exact = EXACT[step];
	if (exact) return exact;
	if (/^[a-z ]+ · (filter|style|other|draw|tiles)$/.test(step)) return 'other';
	throw new Error(`The chart has no section for the step "${step}": add it to bench/chart.ts`);
}

/** Milliseconds per section, for one average render. */
export function sections(render: AverageRender): Map<string, number> {
	const result = new Map<string, number>(SECTIONS.map((s) => [s.id, 0]));
	for (const [step, ms] of Object.entries(render.steps)) {
		const id = sectionOf(step);
		result.set(id, result.get(id)! + ms);
	}
	return result;
}

const COLUMNS = [
	{ caseName: 'svg-warm', title: 'SVG', x: 270, side: 'left' },
	{ caseName: 'png-warm', title: 'PNG', x: 426, side: 'right' },
] as const;

const W = 720;
const TOP = 44;
const PLOT_H = 340;
const BASE = TOP + PLOT_H;
const H = BASE + 70;
const COL_W = 24;
/** The surface gap between touching segments. */
const GAP = 2;
const LABEL_STEP = 17;
const LEADER = 40;

const STYLE = `
	.s1 { fill: #2a78d6 } .s2 { fill: #eb6834 } .s3 { fill: #1baf7a } .s4 { fill: #eda100 }
	.s5 { fill: #e87ba4 } .s6 { fill: #008300 } .s7 { fill: #4a3aa7 } .s8 { fill: #e34948 }
	.other { fill: #b3b2ad }
	text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }
	.label { font-size: 12px; fill: #52514e }
	.value, .total { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; fill: #0b0b0b }
	.total { font-size: 12px; fill: #52514e }
	.title { font-size: 13px; font-weight: 600; fill: #0b0b0b }
	.caption { font-size: 11px; fill: #7a7974 }
	.leader { stroke: #c9c8c3; stroke-width: 1; fill: none }
	.baseline { stroke: #c9c8c3; stroke-width: 1 }
	@media (prefers-color-scheme: dark) {
		.s1 { fill: #3987e5 } .s2 { fill: #d95926 } .s3 { fill: #199e70 } .s4 { fill: #c98500 }
		.s5 { fill: #d55181 } .s6 { fill: #008300 } .s7 { fill: #9085e9 } .s8 { fill: #e66767 }
		.other { fill: #6b6a65 }
		.label, .total { fill: #c3c2b7 }
		.value, .title { fill: #ffffff }
		.caption { fill: #908f87 }
		.leader, .baseline { stroke: #4a4a46 }
	}
`;

/** The chart of `report`, as an SVG document. */
export function renderChart(report: Report): string {
	const renders = COLUMNS.map((column) => {
		const render = averageRender(report.results, column.caseName);
		if (render.scenarios === 0) {
			throw new Error(`The report has no results for ${column.caseName}`);
		}
		if (Object.keys(render.steps).length === 0) {
			throw new Error('The report has no steps: measure without --no-steps');
		}
		return { column, render, sections: sections(render) };
	});
	const yMax = Math.max(...renders.map((r) => r.render.mean)) * 1.02;
	const y = (ms: number): number => BASE - (ms / yMax) * PLOT_H;

	const body: string[] = [];
	for (const { column, render, sections: values } of renders) {
		const left = column.side === 'left';
		const present = SECTIONS.filter((s) => values.get(s.id)! >= 0.05);
		const items: LabelItem[] = [];
		let acc = 0;
		for (const section of present) {
			const ms = values.get(section.id)!;
			const bottom = y(acc);
			acc += ms;
			const top = y(acc);
			items.push({ section, ms, top, bottom, target: (top + bottom) / 2, y: 0 });
		}
		placeLabels(items);

		body.push(`<g aria-label="${column.title}">`);
		items.forEach((item, i) => {
			const last = i === items.length - 1;
			// Touching segments are separated by a gap; the column's top is its rounded data end.
			const bottom = item.bottom < BASE ? item.bottom - GAP : item.bottom;
			const segment = segmentPath(column.x, item.top, Math.max(item.top + 0.8, bottom), last);
			const edge = left ? column.x - 3 : column.x + COL_W + 3;
			const elbow = left ? column.x - 12 : column.x + COL_W + 12;
			const end = left ? column.x - LEADER : column.x + COL_W + LEADER;
			const swatchX = left ? end - 12 : end + 4;
			const textX = left ? end - 18 : end + 18;
			const label = escape(item.section.label);
			const ms = `${num(item.ms)} ms`;
			// The value sits next to the column on both sides, the name further out.
			const text = left
				? `<text x="${num(textX)}" y="${num(item.y + 4)}" text-anchor="end"><tspan class="label">${label}</tspan><tspan dx="8" class="value">${ms}</tspan></text>`
				: `<text x="${num(textX)}" y="${num(item.y + 4)}"><tspan class="value">${ms}</tspan><tspan dx="8" class="label">${label}</tspan></text>`;
			body.push(
				`<path class="${item.section.color}" d="${segment}"/>`,
				`<path class="leader" d="M${num(edge)},${num(item.target)} H${num(elbow)} L${num(end)},${num(item.y)}"/>`,
				`<rect class="${item.section.color}" x="${num(swatchX)}" y="${num(item.y - 4)}" width="8" height="8" rx="2"/>`,
				text,
			);
		});
		const cx = column.x + COL_W / 2;
		body.push(
			`<text class="total" x="${num(cx)}" y="${num(y(render.mean) - 12)}" text-anchor="middle">${num(render.mean)} ms</text>`,
			`<text class="title" x="${num(cx)}" y="${num(BASE + 24)}" text-anchor="middle">${column.title}</text>`,
			'</g>',
		);
	}

	const scenarios = renders[0]!.render.scenarios;
	const size = report.size.replace('x', '×');
	const caption =
		`Average warm render of ${String(scenarios)} scenarios at ${size} px · ` +
		`${report.cpu} · Node ${report.node} · ${report.date.slice(0, 10)} · ${report.commit}`;
	const description = renders
		.map(({ column, render }) => `${column.title}: ${num(render.mean)} ms`)
		.join(', ');

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(W)} ${String(H)}" width="${String(W)}" height="${String(H)}" role="img" aria-labelledby="title">`,
		`<title id="title">Average render time by step. ${escape(description)}.</title>`,
		`<style>${STYLE}</style>`,
		`<line class="baseline" x1="200" x2="520" y1="${String(BASE)}" y2="${String(BASE)}"/>`,
		...body,
		`<text class="caption" x="${String(W / 2)}" y="${String(H - 12)}" text-anchor="middle">${escape(caption)}</text>`,
		'</svg>',
		'',
	].join('\n');
}

interface LabelItem {
	section: Section;
	ms: number;
	top: number;
	bottom: number;
	/** Where the label would sit: the middle of its segment. */
	target: number;
	/** Where it does sit, moved apart from its neighbors. */
	y: number;
}

/** Labels at their segment's middle, pushed apart where they would overlap. */
function placeLabels(items: LabelItem[]): void {
	const sorted = [...items].sort((a, b) => a.target - b.target);
	if (sorted.length === 0) return;
	sorted[0]!.y = sorted[0]!.target;
	for (let i = 1; i < sorted.length; i++) {
		sorted[i]!.y = Math.max(sorted[i]!.target, sorted[i - 1]!.y + LABEL_STEP);
	}
	const overflow = sorted.at(-1)!.y - (BASE - 4);
	if (overflow > 0) {
		sorted.at(-1)!.y -= overflow;
		for (let i = sorted.length - 2; i >= 0; i--) {
			sorted[i]!.y = Math.min(sorted[i]!.y, sorted[i + 1]!.y - LABEL_STEP);
		}
	}
}

/** A segment of a column; `roundTop` gives it the 4px rounded data end. */
function segmentPath(x: number, top: number, bottom: number, roundTop: boolean): string {
	const r = roundTop ? Math.min(4, bottom - top, COL_W / 2) : 0;
	const right = x + COL_W;
	return r > 0
		? `M${num(x)},${num(bottom)} V${num(top + r)} Q${num(x)},${num(top)} ${num(x + r)},${num(top)} H${num(right - r)} Q${num(right)},${num(top)} ${num(right)},${num(top + r)} V${num(bottom)} Z`
		: `M${num(x)},${num(bottom)} V${num(top)} H${num(right)} V${num(bottom)} Z`;
}

/** One decimal, so that equal reports give equal files. */
function num(value: number): string {
	return value.toFixed(1);
}

function escape(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
