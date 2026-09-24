/**
 * What the published packages use of the renderer core. They import it from here only; the
 * rest of the core is internal.
 */
export { LRUCache } from './lru_cache.js';
export {
	SVGMapRenderer,
	viewSize,
	type SVGMapRendererOptions,
	type ViewOptions,
} from './map_renderer.js';
export type { GlobalState } from './pipeline/style_layer.js';
export { renderToSVG, type RenderToSVGOptions } from './render_svg.js';
export { CanvasRenderer } from './renderer/canvas.js';
export type { FetchFunction, FetchResponse } from './sources/index.js';
