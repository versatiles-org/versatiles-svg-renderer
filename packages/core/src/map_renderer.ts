import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { drawMap, type RenderContext } from './pipeline/render.js';
import { getGlobalState, getLayerStyles, type GlobalState } from './pipeline/style_layer.js';
import { SVGRenderer } from './renderer/svg.js';
import type { LabelMode, Renderer } from './renderer/types.js';
import { loadSprite, type SpriteAtlas } from './sources/sprite.js';
import { TileCache } from './sources/tile_cache.js';
import { MAX_LATITUDE, mercatorToLonLat, Projection, type Padding } from './projection.js';
import { Point2D } from './geometry.js';
import { toFetchFunction, type FetchFunction } from './sources/fetch.js';
import { resolveSources } from './sources/resolve.js';
import { loadGlyphRange, type GlyphRange } from './sources/glyphs.js';
import { checkSources, checkStyle } from './pipeline/support.js';

/** Options for {@link SVGMapRenderer}: what stays the same for every view of the map. */
export interface SVGMapRendererOptions {
	/**
	 * The MapLibre style to render.
	 *
	 * A source may list its tile URLs (`tiles: [...]`) or point at a TileJSON document
	 * (`url: '.../tiles.json'`), which is fetched once, like the sprite, with
	 * {@link SVGMapRendererOptions.fetch}. As in MapLibre GL JS, `tiles`, `minzoom`,
	 * `maxzoom` and the like come from the document unless the style sets them, and
	 * relative tile URLs are resolved against the document's URL. A GeoJSON source's `data`
	 * may be a URL too. A source whose TileJSON or GeoJSON cannot be loaded is left out, and
	 * the next render tries again.
	 */
	style: StyleSpecification;
	/**
	 * Whether and how to draw the style's symbol layers, its labels and icons:
	 *
	 * - `'none'`: neither labels nor icons.
	 * - `'text'`: labels as `<text>` naming the style's fonts (`text-font`), which whatever
	 *   displays the SVG resolves, so they show in the intended typeface only where that font
	 *   is installed. In PNG output, with the fonts given by `fonts`.
	 * - `'glyphs'`: labels as the style's own glyphs (`glyphs`), the letter shapes MapLibre
	 *   draws, traced into outlines: exact in every viewer and editor, but not text. Each
	 *   glyph is defined once and reused.
	 * - `'glyphs-text'`: as `'glyphs'`, with the text laid invisibly over the outlines, so labels
	 *   stay selectable and searchable. (In PNG output, the same as `'glyphs'`.)
	 *
	 * Labels are placed as in MapLibre: at points, inside each polygon at the point farthest
	 * from its edges, and along lines; labels and icons that would overlap one placed before
	 * are left out, from the top layer down. With glyphs, they are laid out with MapLibre's
	 * own metrics; as text, with the widths of Noto Sans. A style without `glyphs`, or glyphs
	 * that cannot be loaded, fall back to `'text'`, reported through `onWarning`.
	 * @defaultValue `'none'`, or as given by {@link SVGMapRendererOptions.renderLabels}
	 */
	labels?: LabelMode;
	/**
	 * Draw the style's labels and icons.
	 * @deprecated Use {@link SVGMapRendererOptions.labels}: `true` is `'glyphs-text'`, `false`
	 *   is `'none'`.
	 * @defaultValue `false`
	 */
	renderLabels?: boolean;
	/**
	 * How much memory the fetched tiles may take, in bytes. Tiles are kept so that
	 * rendering an overlapping view does not fetch them again; beyond this size, the least
	 * recently used ones are dropped. `0` keeps none.
	 *
	 * Tiles are kept for the lifetime of the instance, regardless of the HTTP caching
	 * headers they were served with; see {@link SVGMapRenderer.clearCache}.
	 * @defaultValue `134217728` (128 MB)
	 */
	tileCacheSize?: number;
	/**
	 * Loads tiles, sprites, TileJSON documents and GeoJSON data, like `fetch`, which is the default. Pass your own to send
	 * headers, go through a proxy, or keep tiles in a cache on disk.
	 *
	 * It must return a real `Response`, and its status matters: a 404 or 204 means the
	 * server has no such tile, which is remembered (see {@link SVGMapRendererOptions.tileCacheSize}); any other
	 * error status, or a rejected promise, counts as failed, and the next render tries
	 * again.
	 * @defaultValue the global `fetch`
	 */
	fetch?: FetchFunction;
	/**
	 * Called with a message for each part of the style the renderer does not draw: a layer
	 * type, a layer property, a source, or a TileJSON document that could not be loaded. Each
	 * message is reported once per instance. Pass `() => {}` to silence them.
	 *
	 * Properties that make no difference to a flat, north-up map (e.g. `*-pitch-alignment`)
	 * are not reported, nor are symbol layers unless {@link SVGMapRendererOptions.labels}
	 * is set.
	 * @defaultValue `console.warn`
	 */
	onWarning?: (message: string) => void;
	/**
	 * Values for the style's global state, read by `global-state` expressions, e.g. to
	 * switch the language or a theme of a style. They override the defaults in the style's
	 * `state`, like `map.setGlobalStateProperty(name, value)` in MapLibre GL JS.
	 * @defaultValue the defaults of the style's `state`
	 */
	globalState?: GlobalState;
}

/** Default for {@link SVGMapRendererOptions.tileCacheSize}: 128 MB. */
export const DEFAULT_TILE_CACHE_SIZE = 128 * 1024 * 1024;

/** The view to render: size, centre and zoom. */
export interface ViewOptions {
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
	 * @defaultValue the longitude of the style's `center`, else `0`
	 */
	lon?: number;
	/**
	 * Latitude of the map centre, in degrees.
	 * @defaultValue the latitude of the style's `center`, else `0`
	 */
	lat?: number;
	/**
	 * Zoom level, as in MapLibre: each step doubles the scale. Fractional values are
	 * allowed.
	 * @defaultValue the style's `zoom`, else `2`
	 */
	zoom?: number;
	/**
	 * The compass direction that is up, in degrees, as in MapLibre: `90` puts east at the
	 * top. The map turns around the image's center; labels stay upright.
	 * @defaultValue the style's `bearing`, else `0`
	 */
	bearing?: number;
	/**
	 * Space around the map's center, in pixels, as MapLibre's `padding`: the center (`lon`,
	 * `lat`) sits in the middle of the area inside it, e.g. to keep it clear of a panel laid
	 * over the image. A number applies to all sides.
	 * @defaultValue `0`
	 */
	padding?: number | Padding;
}

/**
 * The center and zoom of a view, with defaults applied: as in MapLibre GL JS, the style's
 * own `center` and `zoom` where the view does not set them.
 */
function viewCenter(
	style: StyleSpecification,
	view: ViewOptions,
): { center: [number, number]; zoom: number; bearing: number; padding: Padding } {
	const [styleLon, styleLat] = Array.isArray(style.center) ? style.center : [];
	return {
		center: [view.lon ?? finiteOr(styleLon, 0), view.lat ?? finiteOr(styleLat, 0)],
		zoom: view.zoom ?? finiteOr(style.zoom, 2),
		bearing: view.bearing ?? finiteOr(style.bearing, 0),
		padding:
			typeof view.padding === 'number'
				? { top: view.padding, right: view.padding, bottom: view.padding, left: view.padding }
				: (view.padding ?? {}),
	};
}

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The projection of a view: shared by rendering and {@link SVGMapRenderer.project}. */
function projectionOf(
	style: StyleSpecification,
	width: number,
	height: number,
	view: ViewOptions,
): Projection {
	return Projection.fromStyle({
		width,
		height,
		...viewCenter(style, view),
		projection: style.projection,
	});
}

/**
 * The image size of a view, with defaults applied.
 * @throws If `width` or `height` is not positive.
 */
export function viewSize(view: ViewOptions): { width: number; height: number } {
	const width = view.width ?? 1024;
	const height = view.height ?? 1024;
	if (width <= 0) throw new Error('width must be positive');
	if (height <= 0) throw new Error('height must be positive');
	return { width, height };
}

/**
 * Renders many views of one MapLibre style as SVG.
 *
 * Does the work that depends only on the style once, when constructed or on the first
 * render, instead of on every call as {@link renderToSVG} does: the style is parsed once,
 * and the sprite (the icons, needed with `labels`) and the glyphs are fetched once. Tiles are kept
 * too (up to {@link SVGMapRendererOptions.tileCacheSize}), so overlapping views share
 * them. Use it to render a batch of views, e.g. thumbnails or a series of map sections.
 *
 * The style is read when the instance is created and is expected not to change
 * afterwards; to render a changed style, create a new instance. Renders may run
 * concurrently.
 *
 * @example Render several views of one style
 * ```ts
 * import { SVGMapRenderer } from '@versatiles/svg-renderer';
 *
 * const map = new SVGMapRenderer({ style });
 *
 * const berlin = await map.renderSVG({ lon: 13.4, lat: 52.52, zoom: 12 });
 * const potsdam = await map.renderSVG({ lon: 13.06, lat: 52.4, zoom: 12 });
 * ```
 */
export class SVGMapRenderer {
	readonly #style: StyleSpecification;
	readonly #labels: LabelMode;
	readonly #context: RenderContext;
	readonly #tiles: TileCache;
	readonly #fetch: FetchFunction;
	#sprite: Promise<SpriteAtlas> | undefined;
	#sources: Promise<StyleSpecification['sources']> | undefined;
	readonly #glyphRanges = new Map<string, Promise<GlyphRange | undefined>>();
	readonly #onWarning: (message: string) => void;
	readonly #warned = new Set<string>();

	/**
	 * @param options - The style, whether to draw labels, the tile cache size, how to load
	 *   tiles and sprites, and where to report unsupported parts of the style.
	 * @throws If `tileCacheSize` is negative or not a number.
	 */
	public constructor(options: SVGMapRendererOptions) {
		this.#style = options.style;
		this.#onWarning = options.onWarning ?? ((message) => console.warn(message));
		let labels: LabelMode =
			// eslint-disable-next-line @typescript-eslint/no-deprecated -- still supported, mapped to `labels`
			options.labels ?? (options.renderLabels === true ? 'glyphs-text' : 'none');
		if (
			(labels === 'glyphs' || labels === 'glyphs-text') &&
			typeof options.style.glyphs !== 'string'
		) {
			this.#warn('The style has no "glyphs": labels are drawn as text.');
			labels = 'text';
		}
		this.#labels = labels;
		this.#fetch = toFetchFunction(options.fetch);
		this.#tiles = new TileCache(options.tileCacheSize ?? DEFAULT_TILE_CACHE_SIZE, this.#fetch);
		this.#context = {
			layers: getLayerStyles(
				options.style.layers,
				getGlobalState(options.style, options.globalState),
			),
			getSprite: () => this.#getSprite(),
			getSources: () => this.#getSources(),
			loadTile: this.#tiles.load,
			getGlyphRange: (fontStack, start) => this.#getGlyphRange(fontStack, start),
			outlines: new Map(),
		};
		for (const warning of checkStyle(options.style, labels !== 'none')) this.#warn(warning);
	}

	/**
	 * Renders one view of the map as SVG. The result is a single self-contained SVG
	 * document, as described on {@link renderToSVG}.
	 *
	 * @param view - Size, centre and zoom. All optional.
	 * @returns The SVG document, as a string beginning with `<svg`.
	 * @throws If `width` or `height` is not positive.
	 */
	public async renderSVG(view: ViewOptions = {}): Promise<string> {
		const renderer = await this.draw(new SVGRenderer(viewSize(view)), view);
		return renderer.getString();
	}

	/**
	 * Forgets the fetched tiles, sprite, TileJSON documents and GeoJSON data, so the next render fetches them again, e.g.
	 * after they were updated on the server, or to free their memory.
	 */
	public clearCache(): void {
		this.#tiles.clear();
		this.#sprite = undefined;
		this.#sources = undefined;
		this.#glyphRanges.clear();
		this.#context.outlines.clear();
	}

	/** Draws `view` onto `renderer`, which must already have the view's size. */
	protected async draw<R extends Renderer>(renderer: R, view: ViewOptions): Promise<R> {
		return drawMap(
			{
				renderer,
				style: this.#style,
				view: viewCenter(this.#style, view),
				labels: this.#labels,
				projection: projectionOf(this.#style, renderer.width, renderer.height, view),
			},
			this.#context,
		);
	}

	/**
	 * Where a coordinate lands in the image of `view`: its position in the units of
	 * `width` and `height`, the same in the SVG and on the canvas of `renderCanvas`. Use
	 * it to place your own drawing on the map.
	 *
	 * On the globe, a coordinate on its far side is hidden; then this returns `undefined`.
	 * A position outside the image is returned as is, so it can lie beyond `width` and
	 * `height`, or be negative. The map ends at about ±85.05° latitude, as in MapLibre: a
	 * latitude beyond that, up to the poles, gives the position of the map's edge.
	 *
	 * @example Mark a place on a rendered canvas
	 * ```ts
	 * const view = { lon: 13.4, lat: 52.52, zoom: 12 };
	 * const canvas = await map.renderCanvas(view);
	 * const [x, y] = map.project(view, [13.3777, 52.5163])!; // Brandenburg Gate
	 * const ctx = canvas.getContext('2d');
	 * ctx.beginPath();
	 * ctx.arc(x, y, 6, 0, 2 * Math.PI);
	 * ctx.fill();
	 * ```
	 *
	 * @param view - The view the image was rendered with.
	 * @param lonLat - Longitude and latitude, in degrees.
	 * @returns `[x, y]`, or `undefined` for a point hidden on the globe, and for a
	 *   longitude or latitude that is not a finite number.
	 * @throws If `width` or `height` is not positive.
	 */
	public project(view: ViewOptions, lonLat: [number, number]): [number, number] | undefined {
		const { width, height } = viewSize(view);
		if (!lonLat.every(Number.isFinite)) return undefined;
		const projection = projectionOf(this.#style, width, height, view);
		const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lonLat[1]));
		const mercator = new Point2D(lonLat[0], lat).getProject2Pixel();
		const onSphere = projection.toSphere(mercator.x, mercator.y);
		if (!projection.isVisible(onSphere)) return undefined;
		const { x, y } = projection.project(mercator.x, mercator.y, onSphere);
		return [x, y];
	}
	/**
	 * The opposite of {@link SVGMapRenderer.project}: the coordinate shown at a position in
	 * the image of `view`, e.g. where a user clicked on it.
	 *
	 * Where the image shows no map — next to the globe, or beyond the poles of the mercator
	 * map (about ±85°) — this returns `undefined`. The longitude is between -180 and 180.
	 *
	 * @param view - The view the image was rendered with.
	 * @param xy - A position in the units of `width` and `height`.
	 * @returns `[lon, lat]` in degrees, or `undefined` where there is no map, and for a
	 *   position that is not a finite number.
	 * @throws If `width` or `height` is not positive.
	 */
	public unproject(view: ViewOptions, xy: [number, number]): [number, number] | undefined {
		const { width, height } = viewSize(view);
		if (!xy.every(Number.isFinite)) return undefined;
		const mercator = projectionOf(this.#style, width, height, view).unproject(xy[0], xy[1]);
		return mercator && mercatorToLonLat(mercator[0], mercator[1]);
	}

	/**
	 * Fetches the sprite once and shares it between renders, including concurrent first
	 * ones. A sprite that failed to load is fetched again by the next render.
	 */
	#getSprite(): Promise<SpriteAtlas> {
		if (this.#sprite) return this.#sprite;
		const sprite = loadSprite(this.#style, this.#fetch).then(({ atlas, complete }) => {
			if (!complete && this.#sprite === sprite) this.#sprite = undefined;
			return atlas;
		});
		this.#sprite = sprite;
		return sprite;
	}

	/**
	 * Fetches the TileJSON documents and GeoJSON data of the style's sources once and shares them between
	 * renders, like the sprite. If one failed to load, the next
	 * render fetches them again.
	 */
	#getSources(): Promise<StyleSpecification['sources']> {
		if (this.#sources) return this.#sources;
		const sources = resolveSources(this.#style.sources, this.#fetch).then((result) => {
			if (!result.complete && this.#sources === sources) this.#sources = undefined;
			for (const warning of checkSources(result.sources)) this.#warn(warning);
			return result.sources;
		});
		this.#sources = sources;
		return sources;
	}

	/**
	 * Loads a range of glyphs once and shares it between renders. A range that could not be
	 * loaded is reported, and loaded again by the next render.
	 */
	#getGlyphRange(fontStack: string, start: number): Promise<GlyphRange | undefined> {
		const template = this.#style.glyphs;
		if (typeof template !== 'string') return Promise.resolve(undefined);
		const key = `${fontStack}\0${String(start)}`;
		let range = this.#glyphRanges.get(key);
		if (!range) {
			range = loadGlyphRange(template, fontStack, start, this.#fetch).then((glyphs) => {
				if (!glyphs) {
					this.#glyphRanges.delete(key);
					this.#warn(
						`The glyphs ${String(start)}-${String(start + 255)} of "${fontStack}" could not be loaded: their labels are drawn as text.`,
					);
				}
				return glyphs;
			});
			this.#glyphRanges.set(key, range);
		}
		return range;
	}

	/** Reports `message` through `onWarning`, unless it was reported before. */
	#warn(message: string): void {
		if (this.#warned.has(message)) return;
		this.#warned.add(message);
		this.#onWarning(message);
	}
}
