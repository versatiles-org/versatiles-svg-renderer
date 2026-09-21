/**
 * The complete public API of all three packages, gathered in one module for the API
 * documentation.
 *
 * The documentation generator reads a single entry point, so this module re-exports every
 * package's API. Nothing imports it: each symbol's documentation names the package to
 * import it from.
 *
 * | Package                           | Provides                                                   |
 * | --------------------------------- | ---------------------------------------------------------- |
 * | `@versatiles/svg-renderer`        | {@link renderToSVG} (Node.js and browser)                  |
 * | `@versatiles/png-renderer`        | {@link renderToPNG} and {@link renderToSVG} (Node.js)      |
 * | `@versatiles/maplibre-svg-export` | {@link SVGExportControl} and {@link renderToSVG} (browser) |
 *
 * @module
 */
export { renderToSVG, type RenderToSVGOptions } from './packages/svg-renderer/src/index.js';
export { renderToPNG, type RenderToPNGOptions } from './packages/png-renderer/src/index.js';
export {
	SVGExportControl,
	type SVGExportControlOptions,
} from './packages/maplibre-svg-export/src/index.js';
