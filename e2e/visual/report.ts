/**
 * The HTML report of a run: per region, its numbers graded against the baseline, and the
 * three renders and three diffs side by side.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Region } from '../regions.js';
import { fails, gate, type Baseline, type Metrics } from './compare.js';
import { HEIGHT, outputDir, WIDTH } from './output.js';

/** What a run found for one region. */
export interface Result {
	region: Region;
	metrics: Metrics;
	/** A grid scene's cells, by title. */
	cells?: Record<string, Metrics>;
	svgSizeKB: number;
	pngSizeKB: number;
}

/** Six image columns, so they are sized to stay readable side by side. */
const THUMB = Math.round(WIDTH / 3);

/** Writes `output/report.html`. Returns its path. */
export function writeReport(results: Result[], baseline: Baseline): string {
	const rows = results.map((result) => row(result, baseline[result.region.id])).join('\n');
	const path = resolve(outputDir, 'report.html');
	writeFileSync(path, page(rows));
	return path;
}

/**
 * A metric, graded against the baseline exactly as the console does, so a regression cannot
 * read as fine here just because its value happens to be small.
 */
function metricCell(label: string, value: number, base: number | undefined): string {
	const verdict = gate(value, base);
	const failed = fails(verdict);
	const improved = verdict.kind === 'better';
	const color = failed ? 'red' : improved ? 'green' : value > 20 ? 'orange' : '#333';
	const mark = failed ? ' ▲' : improved ? ' ▼' : '';
	const was =
		base === undefined ? '' : ` <span style="color:#888">(was ${base.toFixed(2)}%)</span>`;
	return `<div><strong>${label}:</strong> <span style="color:${color}">${value.toFixed(2)}%${mark}</span>${was}</div>`;
}

/** A grid scene's cells and their metrics, graded against their baselines. */
function cellTable(cells: Record<string, Metrics>, base: Baseline[string] | undefined): string {
	const grade = (value: number, baseValue: number | undefined): string => {
		const verdict = gate(value, baseValue);
		const color = fails(verdict) ? 'red' : verdict.kind === 'better' ? 'green' : '#333';
		const mark = fails(verdict) ? ' ▲' : verdict.kind === 'better' ? ' ▼' : '';
		return `<td style="color:${color}">${value.toFixed(2)}%${mark}</td>`;
	};
	const rows = Object.entries(cells).map(([title, cell]) => {
		const cellBase = base?.cells?.[title];
		return `<tr><td>${title}</td>${grade(cell.svg, cellBase?.svg)}${grade(cell.png, cellBase?.png)}${grade(cell.drift, cellBase?.drift)}</tr>`;
	});
	return `<table class="cells"><tr><th>cell</th><th>SVG</th><th>PNG</th><th>drift</th></tr>${rows.join('')}</table>`;
}

function row(
	{ region, metrics, cells, svgSizeKB, pngSizeKB }: Result,
	base?: Baseline[string],
): string {
	const { id, view } = region;
	const thumb = (dir: string, link: string): string =>
		`<td><a href="${link}"><img src="${dir}/${id}.png" width="${THUMB}" height="${Math.round((THUMB * HEIGHT) / WIDTH)}"></a></td>`;
	return `<tr>
	<td>
		<strong>${id}</strong><br>
		lon: ${view.lon}<br>
		lat: ${view.lat}<br>
		zoom: ${view.zoom}<br>${view.bearing ? `\n\t\tbearing: ${view.bearing}<br>` : ''}
		style: ${region.style}${region.projection ? `, ${region.projection}` : ''}${region.labels ? ' + labels' : ''}<br>
		SVG: ${svgSizeKB.toFixed(0)} KB<br>
		PNG: ${pngSizeKB.toFixed(0)} KB<br>
		${metricCell('SVG vs ML', metrics.svg, base?.svg)}
		${metricCell('PNG vs ML', metrics.png, base?.png)}
		${metricCell('drift', metrics.drift, base?.drift)}
		${cells ? cellTable(cells, base) : ''}
	</td>
	${thumb('maplibre', `maplibre/${id}.png`)}
	${thumb('svg', `svg/${id}.svg`)}
	${thumb('png', `png/${id}.png`)}
	${thumb('diff', `diff/${id}.png`)}
	${thumb('diff-png', `diff-png/${id}.png`)}
	${thumb('drift', `drift/${id}.png`)}
</tr>`;
}

function page(rows: string): string {
	return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>E2E Visual Comparison Report</title>
<style>
	body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }
	h1 { margin-bottom: 20px; }
	table { border-collapse: collapse; }
	th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; background: white; }
	th { background: #eee; position: sticky; top: 0; z-index: 2; }
	/* The table is wider than most screens; keep each region and its numbers in view. */
	td:first-child, th:first-child { position: sticky; left: 0; }
	th:first-child { z-index: 3; }
	img { display: block; }
	td div { margin-top: 4px; white-space: nowrap; }
	table.cells { margin-top: 8px; font-size: 12px; }
	table.cells th, table.cells td { position: static; padding: 2px 6px; white-space: nowrap; }
</style>
</head><body>
<h1>E2E Visual Comparison Report</h1>
<p>Generated: ${new Date().toISOString()}</p>
<p>
	MapLibre is the reference. <em>SVG vs ML</em> and <em>PNG vs ML</em> grade each renderer
	against it; <em>drift</em> is the two renderers against each other, which catches one
	backend diverging even while both stay close to MapLibre.
</p>
<table>
<tr>
	<th>Region</th>
	<th>MapLibre (reference)</th>
	<th>SVG renderer</th>
	<th>PNG renderer</th>
	<th>Diff: SVG vs ML</th>
	<th>Diff: PNG vs ML</th>
	<th>Drift: SVG vs PNG</th>
</tr>
${rows}
</table>
</body></html>`;
}
