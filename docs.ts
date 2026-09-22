/**
 * The complete public API of all three packages, gathered in one module for the API
 * documentation.
 *
 * The documentation generator reads a single entry point, so this module re-exports every
 * package's API. Nothing imports it: each symbol's documentation names the package to
 * import it from.
 *
 * | Package                           | Provides                                                                                                         | Runs in           |
 * | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
 * | `@versatiles/svg-renderer`        | {@link renderToSVG}, {@link SVGMapRenderer}                                                                      | Node.js, browsers |
 * | `@versatiles/png-renderer`        | {@link renderToPNG}, {@link renderToCanvas}, {@link PNGMapRenderer}, {@link renderToSVG}, {@link SVGMapRenderer} | Node.js           |
 * | `@versatiles/maplibre-svg-export` | {@link SVGExportControl}, {@link renderToSVG}, {@link SVGMapRenderer}                                            | browsers          |
 *
 * `renderToSVG`, `renderToPNG` and `renderToCanvas` render a single view. To render many
 * views of one style, use `SVGMapRenderer` or `PNGMapRenderer`: they parse the style once
 * and keep the sprite and the tiles between renders. Their `project` and `unproject`
 * convert between coordinates and positions in the image.
 *
 * The option and view types, and `FetchFunction` / `FetchResponse` for the `fetch` option,
 * are exported by every package whose functions take them.
 *
 * @module
 */
export {
	renderToSVG,
	SVGMapRenderer,
	type RenderToSVGOptions,
	type SVGMapRendererOptions,
	type ViewOptions,
	type FetchFunction,
	type FetchResponse,
} from './packages/svg-renderer/src/index.js';
export {
	PNGMapRenderer,
	renderToCanvas,
	renderToPNG,
	type PNGMapRendererOptions,
	type PNGViewOptions,
	type RenderToPNGOptions,
} from './packages/png-renderer/src/index.js';
export {
	SVGExportControl,
	type SVGExportControlOptions,
} from './packages/maplibre-svg-export/src/index.js';
