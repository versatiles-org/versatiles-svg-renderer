/**
 * The complete public API, gathered in one module for the API documentation.
 *
 * The package has three entry points, but the documentation generator reads a single
 * one. Pointing it at `index.ts` alone left `renderToPNG` and `SVGExportControl` out of
 * the docs entirely, so this module re-exports all three. Nothing imports it: each
 * symbol's documentation names the entry point to import it from.
 *
 * | Import from                           | Provides                                   |
 * | ------------------------------------- | ------------------------------------------ |
 * | `@versatiles/svg-renderer`            | {@link renderToSVG}                        |
 * | `@versatiles/svg-renderer/png`        | {@link renderToPNG} (Node.js only)         |
 * | `@versatiles/svg-renderer/maplibre`   | {@link SVGExportControl} (browser)         |
 *
 * @module
 */
export { renderToSVG, type RenderToSVGOptions } from './index.js';
export { renderToPNG, type RenderToPNGOptions } from './png.js';
export { SVGExportControl, type SVGExportControlOptions } from './maplibre/control.js';
