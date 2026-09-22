/**
 * What the benchmark and the profiler share: the scenarios, the four ways of rendering
 * each, and a `fetch` that answers from memory, so that measurements see neither the
 * network nor the disk.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { renderToSVG, SVGMapRenderer } from '../packages/svg-renderer/src/index.js';
import { PNGMapRenderer, renderToPNG } from '../packages/png-renderer/src/index.js';
import { installFetchCache, uninstallFetchCache } from '../e2e/fetch-cache.js';
import { fonts, getStyle, regionId, regions, type Region } from '../e2e/styles.js';

/** The size of the rendered image, in pixels. */
export const WIDTH = 1024;
export const HEIGHT = 768;

/**
 * Measured unless `--scenarios` names others: every vector and satellite scenario. The
 * GeoJSON one draws only a handful of test shapes, which says little about speed.
 */
export function defaultScenarioIds(): string[] {
	return regions.filter((region) => region.type !== 'geojson').map(regionId);
}

export const CASES = ['svg-cold', 'svg-warm', 'png-cold', 'png-warm'] as const;
export type CaseName = (typeof CASES)[number];

export const CASE_DESCRIPTIONS: Record<CaseName, string> = {
	'svg-cold': 'renderToSVG: parses the style, fetches and decodes every tile',
	'svg-warm': 'SVGMapRenderer.renderSVG of a view it rendered before: every cache hits',
	'png-cold': 'renderToPNG, as svg-cold',
	'png-warm': 'PNGMapRenderer.renderPNG, as svg-warm',
};

interface Scenario {
	id: string;
	region: Region;
	style: StyleSpecification;
}

/** One way of rendering a scenario. */
interface Case {
	name: CaseName;
	/** Runs once before any measured run, unmeasured: the warm cases fill their caches. */
	setup: () => Promise<void>;
	/** What gets measured. Returns the rendered SVG or PNG. */
	run: () => Promise<string | Uint8Array>;
}

export function scenarioIds(): string[] {
	return regions.map(regionId);
}

/**
 * Loads the styles and records every response the scenarios need, then serves `fetch`
 * from that recording only. Responses come from the e2e disk cache, so the network is
 * used only for what is not cached yet.
 *
 * Every render in the recording pass also warms up the JIT and loads the canvas backend,
 * so the first measured round does not pay for that.
 */
export async function prepare(ids: string[]): Promise<Scenario[]> {
	const unknown = ids.filter((id) => !scenarioIds().includes(id));
	if (unknown.length > 0) {
		throw new Error(`Unknown scenario ${unknown.join(', ')}. Known: ${scenarioIds().join(', ')}`);
	}

	const recorded = new Map<string, { status: number; contentType: string; body: Uint8Array }>();
	installFetchCache();
	const diskFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const response = await diskFetch(input, init);
		const body = new Uint8Array(await response.clone().arrayBuffer());
		const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
		recorded.set(urlOf(input), { status: response.status, contentType, body });
		return response;
	};

	const scenarios: Scenario[] = [];
	try {
		for (const id of ids) {
			const region = regions.find((r) => regionId(r) === id)!;
			const scenario = { id, region, style: await getStyle(region) };
			for (const c of cases(scenario)) {
				await c.setup();
				await c.run();
			}
			scenarios.push(scenario);
		}
	} finally {
		uninstallFetchCache();
	}

	globalThis.fetch = (input) => {
		const url = urlOf(input);
		const entry = recorded.get(url);
		if (!entry) return Promise.reject(new Error(`Not recorded: ${url}`));
		// A fresh copy per response, as from the network: a cold render must not reuse the
		// tile objects of an earlier one.
		return Promise.resolve(
			new Response(entry.body.slice(), {
				status: entry.status,
				headers: { 'content-type': entry.contentType },
			}),
		);
	};
	return scenarios;
}

/** The four ways of rendering a scenario. Call `setup` before `run`. */
export function cases(scenario: Scenario): Case[] {
	const { region, style } = scenario;
	const renderLabels = region.labels ?? false;
	const view = {
		width: WIDTH,
		height: HEIGHT,
		lon: region.lon,
		lat: region.lat,
		zoom: region.zoom,
	};
	const noSetup = (): Promise<void> => Promise.resolve();

	const svgMap = new SVGMapRenderer({ style, renderLabels });
	const pngMap = new PNGMapRenderer({ style, renderLabels, fonts });
	return [
		{
			name: 'svg-cold',
			setup: noSetup,
			run: () => renderToSVG({ style, renderLabels, ...view }),
		},
		{
			name: 'svg-warm',
			setup: async () => {
				await svgMap.renderSVG(view);
			},
			run: () => svgMap.renderSVG(view),
		},
		{
			name: 'png-cold',
			setup: noSetup,
			run: () => renderToPNG({ style, renderLabels, fonts, ...view }),
		},
		{
			name: 'png-warm',
			setup: async () => {
				await pngMap.renderPNG(view);
			},
			run: () => pngMap.renderPNG(view),
		},
	];
}

function urlOf(input: string | URL | Request): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}
