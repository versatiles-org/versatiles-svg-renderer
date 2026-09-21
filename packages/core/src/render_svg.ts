import { SVGRenderer } from './renderer/svg.js';
import { renderMap } from './pipeline/render.js';
import { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

/** Options for {@link renderToSVG}. */
export interface RenderToSVGOptions {
	/**
	 * The MapLibre style to render.
	 *
	 * Its sources must list their tile URLs directly (`tiles: [...]`). A style whose
	 * sources only point at a TileJSON document (`url: '.../tiles.json'`) renders as an
	 * **empty map without any error**, because the renderer does not fetch TileJSON. Styles
	 * built with `@versatiles/style` come in that form, so pass them through its
	 * `inlineSources()` first — see the examples on {@link renderToSVG}.
	 */
	style: StyleSpecification;
	/**
	 * Width of the image in pixels.
	 * @defaultValue `1024`
	 */
	width?: number;
	/**
	 * Height of the image in pixels.
	 * @defaultValue `1024`
	 */
	height?: number;
	/**
	 * Longitude of the map centre, in degrees.
	 * @defaultValue `0`
	 */
	lon?: number;
	/**
	 * Latitude of the map centre, in degrees.
	 * @defaultValue `0`
	 */
	lat?: number;
	/**
	 * Zoom level, as in MapLibre: each step doubles the scale. Fractional values are
	 * allowed.
	 * @defaultValue `2`
	 */
	zoom?: number;
	/**
	 * Draw the style's symbol layers: text labels and icons.
	 *
	 * Off by default, because labels are the least faithful part of the output. They are
	 * drawn as horizontal text at the middle of their feature: labels that MapLibre curves
	 * along a line (`symbol-placement: "line"`, typically street names) come out straight,
	 * and there is no collision detection, so crowded label layers can overlap.
	 *
	 * The SVG names each label's font (`text-font`) and leaves resolving it to whatever
	 * displays the SVG, so labels use the intended typeface only where that font is
	 * installed or provided with `@font-face`.
	 * @defaultValue `false`
	 */
	renderLabels?: boolean;
}

/**
 * Renders a MapLibre style to an SVG image.
 *
 * Fetches the vector and raster tiles the view needs, then draws every layer as SVG
 * elements: fills and lines as paths, raster tiles and sprites as embedded images. The
 * result is a single self-contained SVG document — it references no external files, so
 * it can be saved, inlined into HTML or opened in a vector editor as is.
 *
 * Works in Node.js (22 or later) and in the browser.
 *
 * @example Render a map in Node.js
 * ```ts
 * import { renderToSVG } from '@versatiles/svg-renderer';
 * import { inlineSources, osm } from '@versatiles/style';
 * import { writeFile } from 'node:fs/promises';
 *
 * // inlineSources() resolves the style's TileJSON sources into tile URLs,
 * // which the renderer needs. Without it the map comes out empty.
 * const style = await inlineSources(osm({ theme: 'colorful' }));
 *
 * const svg = await renderToSVG({
 *   style,
 *   width: 800,
 *   height: 600,
 *   lon: 13.4, // Berlin
 *   lat: 52.52,
 *   zoom: 12,
 * });
 *
 * await writeFile('berlin.svg', svg);
 * ```
 *
 * @example Render a hosted style in the browser
 * ```ts
 * import { renderToSVG } from '@versatiles/svg-renderer';
 *
 * // This hosted style already lists its tile URLs, so it can be used directly.
 * const style = await fetch(
 *   'https://tiles.versatiles.org/assets/styles/colorful/style.json',
 * ).then((response) => response.json());
 *
 * document.body.innerHTML = await renderToSVG({ style, width: 800, height: 600, zoom: 3 });
 * ```
 *
 * @example Include labels and icons
 * ```ts
 * const svg = await renderToSVG({ style, lon: 13.4, lat: 52.52, zoom: 14, renderLabels: true });
 * ```
 *
 * @param options - What to render and how large. Only `style` is required.
 * @returns The SVG document, as a string beginning with `<svg`.
 * @throws If `width` or `height` is not positive.
 */
export async function renderToSVG(options: RenderToSVGOptions): Promise<string> {
	const width = options.width ?? 1024;
	const height = options.height ?? 1024;

	if (width <= 0) throw new Error('width must be positive');
	if (height <= 0) throw new Error('height must be positive');

	return await renderMap({
		renderer: new SVGRenderer({ width, height }),
		style: options.style,
		view: {
			center: [options.lon ?? 0, options.lat ?? 0],
			zoom: options.zoom ?? 2,
		},
		renderLabels: options.renderLabels ?? false,
	});
}
