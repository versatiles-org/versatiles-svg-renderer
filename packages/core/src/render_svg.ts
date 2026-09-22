import { SVGMapRenderer, type SVGMapRendererOptions, type ViewOptions } from './map_renderer.js';

/** Options for {@link renderToSVG}: the style and the view, in one object. */
export interface RenderToSVGOptions
	extends Omit<SVGMapRendererOptions, 'tileCacheSize'>, ViewOptions {}

/**
 * Renders a MapLibre style to an SVG image.
 *
 * Fetches the vector and raster tiles the view needs, then draws every layer as SVG
 * elements: fills and lines as paths, raster tiles and sprites as embedded images. The
 * result is a single self-contained SVG document — it references no external files, so
 * it can be saved, inlined into HTML or opened in a vector editor as is.
 *
 * Works in Node.js (22 or later) and in the browser. The same function is exported by
 * `@versatiles/svg-renderer`, `@versatiles/png-renderer` and
 * `@versatiles/maplibre-svg-export`; the examples import it from the first.
 *
 * Each call starts from scratch: it parses the style and fetches the tiles and the
 * sprite again. To render many views of one style, use {@link SVGMapRenderer}, which
 * keeps them between renders.
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
	return new SVGMapRenderer(options).renderSVG(options);
}
