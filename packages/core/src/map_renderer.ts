import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { drawMap, type RenderContext } from './pipeline/render.js';
import { getLayerStyles } from './pipeline/style_layer.js';
import { SVGRenderer } from './renderer/svg.js';
import type { Renderer } from './renderer/types.js';
import { loadSprite, type SpriteAtlas } from './sources/sprite.js';
import { TileCache } from './sources/tile_cache.js';
import { MAX_LATITUDE, mercatorToLonLat, Projection } from './projection.js';
import { Point2D } from './geometry.js';
import { toFetchFunction, type FetchFunction } from './sources/fetch.js';

/** Options for {@link SVGMapRenderer}: what stays the same for every view of the map. */
export interface SVGMapRendererOptions {
	/**
	 * The MapLibre style to render.
	 *
	 * Its sources must list their tile URLs directly (`tiles: [...]`). A style whose
	 * sources only point at a TileJSON document (`url: '.../tiles.json'`) renders as an
	 * **empty map without any error**, because the renderer does not fetch TileJSON. Hosted
	 * styles such as those of VersaTiles list their tiles; a style built with
	 * `@versatiles/style` needs its `inlineSources()` first.
	 */
	style: StyleSpecification;
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
	 * Loads tiles and sprites, like `fetch`, which is the default. Pass your own to send
	 * headers, go through a proxy, or keep tiles in a cache on disk.
	 *
	 * It must return a real `Response`, and its status matters: a 404 or 204 means the
	 * server has no such tile, which is remembered (see {@link SVGMapRendererOptions.tileCacheSize}); any other
	 * error status, or a rejected promise, counts as failed, and the next render tries
	 * again.
	 * @defaultValue the global `fetch`
	 */
	fetch?: FetchFunction;
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
}

/** The center and zoom of a view, with defaults applied. */
function viewCenter(view: ViewOptions): { center: [number, number]; zoom: number } {
	return { center: [view.lon ?? 0, view.lat ?? 0], zoom: view.zoom ?? 2 };
}

/** The projection of a view: shared by rendering and {@link SVGMapRenderer.project}. */
function projectionOf(
	style: StyleSpecification,
	width: number,
	height: number,
	view: ViewOptions,
): Projection {
	return Projection.fromStyle({ width, height, ...viewCenter(view), projection: style.projection });
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
 * and the sprite (the icons, needed with `renderLabels`) is fetched once. Tiles are kept
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
	readonly #renderLabels: boolean;
	readonly #context: RenderContext;
	readonly #tiles: TileCache;
	readonly #fetch: FetchFunction;
	#sprite: Promise<SpriteAtlas> | undefined;

	/**
	 * @param options - The style, whether to draw labels, the tile cache size, and how to
	 *   load tiles and sprites.
	 * @throws If `tileCacheSize` is negative or not a number.
	 */
	public constructor(options: SVGMapRendererOptions) {
		this.#style = options.style;
		this.#renderLabels = options.renderLabels ?? false;
		this.#fetch = toFetchFunction(options.fetch);
		this.#tiles = new TileCache(options.tileCacheSize ?? DEFAULT_TILE_CACHE_SIZE, this.#fetch);
		this.#context = {
			layers: getLayerStyles(options.style.layers),
			getSprite: () => this.#getSprite(),
			loadTile: this.#tiles.load,
		};
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
	 * Forgets the fetched tiles and sprite, so the next render fetches them again, e.g.
	 * after they were updated on the server, or to free their memory.
	 */
	public clearCache(): void {
		this.#tiles.clear();
		this.#sprite = undefined;
	}

	/** Draws `view` onto `renderer`, which must already have the view's size. */
	protected async draw<R extends Renderer>(renderer: R, view: ViewOptions): Promise<R> {
		return drawMap(
			{
				renderer,
				style: this.#style,
				view: viewCenter(view),
				renderLabels: this.#renderLabels,
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
}
