import type { Color as MaplibreColor, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from '../geometry.js';
import type { SpriteAtlas, SpriteEntry } from '../sources/sprite.js';
import type { ClipCircle, Projection } from '../projection.js';

export interface View {
	center: [number, number];
	zoom: number;
}

/**
 * A drawing surface the render pipeline paints a map onto. It only describes *how* to
 * draw; how the result is handed back is up to the backend, because those differ in
 * kind: the SVG backend serializes to a string ({@link StringRenderer}), while a raster
 * backend produces an encoded image buffer.
 */
export interface Renderer {
	readonly width: number;
	readonly height: number;
	/**
	 * These two may be asynchronous, like {@link Renderer.drawIcons}: a pattern is a sprite
	 * image, which a raster backend has to decode first.
	 */
	drawBackgroundFill(style: BackgroundStyle): void | Promise<void>;
	drawPolygons(id: string, features: [Feature, FillStyle][]): void | Promise<void>;
	drawLineStrings(id: string, features: [Feature, LineStyle][]): void;
	drawCircles(id: string, features: [Feature, CircleStyle][]): void;
	/**
	 * Draws text labels, and (below) icons. Each feature is a single point: the pipeline
	 * has already placed the symbol, one per point, line or polygon.
	 */
	drawLabels(id: string, features: [Feature, SymbolStyle][]): void;
	/**
	 * These two may be asynchronous. Their images arrive as data URIs, which a raster
	 * backend has to decode before it can paint them, while the SVG backend simply embeds
	 * the URI and stays synchronous. The pipeline awaits both, so layers keep their order
	 * either way.
	 */
	drawIcons(
		id: string,
		features: [Feature, IconStyle][],
		spriteAtlas: SpriteAtlas,
	): void | Promise<void>;
	drawRasterTiles(id: string, tiles: RasterTile[], style: RasterStyle): void | Promise<void>;
	/** Restricts all drawing to a circle (the silhouette of the globe). */
	setClipCircle?(circle: ClipCircle): void;
	/**
	 * Called once the map is complete: undoes any state set up for drawing it (such as the
	 * clip circle), so that whoever gets the result can keep drawing on it.
	 */
	finish?(): void;
}

/** A {@link Renderer} whose result is text, such as the SVG backend. */
export interface StringRenderer extends Renderer {
	getString(): string;
}

export interface RenderJob<R extends Renderer = Renderer> {
	style: StyleSpecification;
	view: View;
	renderer: R;
	renderLabels?: boolean;
	/** Derived from `view` and `style.projection` when not given. */
	projection?: Projection;
}

export interface RendererOptions {
	width: number;
	height: number;
}

export interface BackgroundStyle {
	color: MaplibreColor;
	opacity: number;
	/** `background-pattern`: drawn instead of `color`. */
	pattern?: FillPattern;
}

/**
 * A sprite image repeated over an area (`fill-pattern`, `background-pattern`), at its
 * display size (`width / pixelRatio`) and anchored to the world, as in MapLibre.
 */
export interface FillPattern {
	/** The image's name in the sprite. */
	name: string;
	sprite: SpriteEntry;
	/**
	 * A screen point where one copy of the image has its top-left corner: the world's
	 * origin, so the pattern moves with the map.
	 */
	origin: [number, number];
}

export interface FillStyle {
	color: MaplibreColor;
	opacity: number;
	/** `fill-pattern`: drawn instead of `color`. */
	pattern?: FillPattern;
	translate: [number, number];
	/**
	 * fill-outline-color. When omitted the fill `color` is used (MapLibre's
	 * default: the antialias outline is drawn in the fill color).
	 */
	outlineColor?: MaplibreColor;
	/**
	 * fill-antialias. When truthy, a ~1px edge outline in `outlineColor` is drawn
	 * over all fills of the layer (a separate pass) so a lower feature's border
	 * composites on top of later overlapping fills — matching MapLibre for
	 * choropleths and stacked polygons.
	 */
	antialias?: boolean;
}

export interface LineStyle {
	blur: number;
	cap: 'butt' | 'round' | 'square';
	color: MaplibreColor;
	dasharray?: number[];
	join: 'bevel' | 'miter' | 'round';
	miterLimit: number;
	offset: number;
	opacity: number;
	translate: [number, number];
	width: number;
}

export interface CircleStyle {
	color: MaplibreColor;
	/** Opacity of the fill only; the stroke has its own, as in MapLibre. */
	opacity: number;
	radius: number;
	translate: [number, number];
	strokeWidth: number;
	strokeColor: MaplibreColor;
	strokeOpacity: number;
	/** `circle-blur`: the share of the outer radius over which the circle fades out. */
	blur?: number;
}

export interface RasterStyle {
	opacity: number;
	hueRotate: number;
	brightnessMin: number;
	brightnessMax: number;
	saturation: number;
	contrast: number;
	resampling: 'linear' | 'nearest';
}

/** One character of a label along a line: its center, and its angle in degrees. */
export interface GlyphPlacement {
	text: string;
	x: number;
	y: number;
	angle: number;
}

export interface SymbolStyle {
	/**
	 * For a label along a line: where each of its characters goes. The label is drawn glyph
	 * by glyph there, centered on each position, instead of at the feature's point.
	 */
	path?: GlyphPlacement[];
	/**
	 * For a label of several lines: each line, and the point its alignment (`justify`)
	 * refers to, vertically at the middle of the line. The anchor and offset are applied
	 * already; `text` is all lines.
	 */
	lines?: { text: string; x: number; y: number }[];
	/** How the `lines` align at their points (`text-justify`). */
	justify?: 'left' | 'center' | 'right';
	/** `text-letter-spacing`, in ems. */
	letterSpacing?: number;
	text: string;
	size: number;
	font: string[];
	anchor: string;
	offset: [number, number];
	rotate: number;
	color: MaplibreColor;
	opacity: number;
	haloColor: MaplibreColor;
	haloWidth: number;
}

export interface IconStyle {
	image: string;
	size: number;
	anchor: string;
	offset: [number, number];
	rotate: number;
	opacity: number;
	sdf: boolean;
	color: MaplibreColor;
	haloColor: MaplibreColor;
	haloWidth: number;
}

export interface RasterTile {
	x: number;
	y: number;
	width: number;
	height: number;
	dataUri: string;
	/**
	 * On the globe a tile cannot be drawn as a rectangle. Instead it is split into a mesh of
	 * triangles, each drawn with its own affine transform.
	 */
	triangles?: RasterTriangle[];
}

type Triangle = [[number, number], [number, number], [number, number]];

export interface RasterTriangle {
	/** Corners of the triangle within the tile image, in tile units (0..1). */
	source: Triangle;
	/** The same corners on screen, in pixels. */
	target: Triangle;
}
