import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GlyphOutline, SpriteAtlas } from '../types.js';
import {
	defaultFetch,
	type FetchFunction,
	getTile,
	type GlyphRange,
	loadGlyphRange,
	loadSpriteAtlas,
	resolveSources,
	type TileLoader,
} from '../sources/index.js';
import { getGlobalState, getLayerStyles, type StyleLayer } from './style_layer.js';

/**
 * What rendering needs from a style besides the view: prepared once per style, so that
 * rendering many views of one style does not redo it. Shared by concurrent renders, so
 * nothing in it may depend on a view.
 */
export interface RenderContext {
	/** The style's layers, parsed. */
	layers: StyleLayer[];
	/** The style's sprite atlas. Only called when labels are rendered. */
	getSprite(): Promise<SpriteAtlas>;
	/** The style's sources, with TileJSON sources completed (see {@link resolveSources}). */
	getSources(): Promise<StyleSpecification['sources']>;
	loadTile: TileLoader;
	/**
	 * A range of 256 glyphs of a font stack, from the style's `glyphs`: `undefined` if it cannot
	 * be loaded.
	 */
	getGlyphRange(fontStack: string, start: number): Promise<GlyphRange | undefined>;
	/** Traced glyph outlines, by font stack and code point, shared by renders. */
	outlines: Map<string, GlyphOutline>;
}

/** A context without any caching, for rendering a single view. */
export function createRenderContext(
	style: StyleSpecification,
	fetchFn: FetchFunction = defaultFetch,
): RenderContext {
	return {
		layers: getLayerStyles(style.layers, getGlobalState(style)),
		getSprite: () => loadSpriteAtlas(style, fetchFn),
		getSources: async () => (await resolveSources(style.sources, fetchFn)).sources,
		loadTile: (url, z, x, y) => getTile(url, z, x, y, fetchFn),
		getGlyphRange: (fontStack, start) =>
			typeof style.glyphs === 'string'
				? loadGlyphRange(style.glyphs, fontStack, start, fetchFn)
				: Promise.resolve(undefined),
		outlines: new Map(),
	};
}
