/**
 * The complete public API of all three packages, gathered in one module for the API
 * documentation.
 *
 * The documentation generator reads a single entry point, so this module re-exports every
 * package's API. Nothing imports it: each symbol's documentation names the package to
 * import it from.
 *
 * | Package                           | Provides                                                                                         |
 * | --------------------------------- | ------------------------------------------------------------------------------------------------ |
 * | `@versatiles/svg-renderer`        | {@link renderToSVG}, {@link SVGMapRenderer} (Node.js and browser)                                |
 * | `@versatiles/png-renderer`        | {@link renderToPNG}, {@link PNGMapRenderer}, {@link renderToSVG}, {@link SVGMapRenderer} (Node.js) |
 * | `@versatiles/maplibre-svg-export` | {@link SVGExportControl}, {@link renderToSVG}, {@link SVGMapRenderer} (browser)                  |
 *
 * `renderToSVG` and `renderToPNG` render a single view. To render many views of one style,
 * use `SVGMapRenderer` or `PNGMapRenderer`: they parse the style once and keep the sprite
 * and the tiles between renders.
 *
 * @module
 */
export {
	renderToSVG,
	SVGMapRenderer,
	type RenderToSVGOptions,
	type SVGMapRendererOptions,
	type ViewOptions,
} from './packages/svg-renderer/src/index.js';
export {
	PNGMapRenderer,
	renderToPNG,
	type PNGMapRendererOptions,
	type PNGViewOptions,
	type RenderToPNGOptions,
} from './packages/png-renderer/src/index.js';
export {
	SVGExportControl,
	type SVGExportControlOptions,
} from './packages/maplibre-svg-export/src/index.js';
