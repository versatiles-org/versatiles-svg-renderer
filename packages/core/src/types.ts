import type { Color as MaplibreColor, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { ClipCircle, Feature, Padding, Projection, RasterTriangle } from './geo/index.js';
import type { SpriteAtlas, SpriteEntry } from './sources/index.js';

export interface View {
	center: [number, number];
	zoom: number;
	/** The compass direction that is up, in degrees (see `Projection.bearing`). */
	bearing?: number;
	/** Space around the map's center, in pixels (see `Projection`). */
	padding?: Padding;
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
	/** May be asynchronous, as a line pattern is a sprite image (see `drawPolygons`). */
	drawLineStrings(id: string, features: [Feature, LineStyle][]): void | Promise<void>;
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

/**
 * How labels and icons are drawn: not at all, as `<text>`, as the style's glyphs traced
 * into outlines, or as those with invisible text over them.
 */
export type LabelMode = 'none' | 'text' | 'glyphs' | 'glyphs-text';

/**
 * A glyph's outline, in pixels at 24 per em (`GLYPH_EM`), as closed rings (to be filled
 * even-odd): x from the middle of its advance, y from the middle of its line of text.
 */
export interface GlyphOutline {
	/** Identifies the outline, for renderers that define each once. */
	key: string;
	rings: [number, number][][];
	/** The glyph's advance, in ems. */
	advance: number;
}

/** A glyph of a label drawn as glyphs: its outline, its middle on screen, angle and scale. */
export interface PlacedGlyph {
	outline: GlyphOutline;
	/** Where the middle of the glyph's advance lies, in the middle of its line of text. */
	x: number;
	y: number;
	/** Clockwise, in degrees. */
	angle: number;
	/** From the outline's units (24 per em) to pixels: the text size / 24. */
	scale: number;
}

export interface RenderJob<R extends Renderer = Renderer> {
	style: StyleSpecification;
	view: View;
	renderer: R;
	/** How to draw labels and icons (see `SVGMapRendererOptions.labels`). */
	labels?: LabelMode;
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
	 * A screen point where one copy of the image has its top-left corner: one aligned with
	 * the world's origin, so the pattern moves with the map.
	 */
	origin: [number, number];
	/** How far the pattern turns around `origin`, clockwise in degrees: with the map's bearing. */
	angle?: number;
	/**
	 * How much larger than its display size the image is drawn (1 if not given): MapLibre
	 * scales patterns with the map from the zoom level's integer part, as its tiles are.
	 */
	scale?: number;
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
	/** `line-pattern`: drawn instead of `color` and `dasharray`. */
	pattern?: LinePattern;
}

/**
 * A sprite image repeated along a line (`line-pattern`), spanning its width, as in MapLibre
 * (see `line_pattern.ts`).
 */
export interface LinePattern {
	/** The image's name in the sprite. */
	name: string;
	sprite: SpriteEntry;
	/** How far one copy of the image reaches along the line, in pixels. */
	period: number;
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
	 * For a label drawn as the style's glyphs: each glyph's outline, where it goes and how
	 * large. Drawn instead of the text.
	 */
	glyphs?: PlacedGlyph[];
	/** With `glyphs`: also the text, invisible, so the label stays selectable and searchable. */
	textOverlay?: boolean;
	/**
	 * For a label of several lines: each line, and the point its alignment (`justify`)
	 * refers to, vertically at the middle of the line. The anchor and offset are applied
	 * already; `text` is all lines.
	 */
	lines?: { text: string; x: number; y: number; width?: number }[];
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
	/**
	 * Fitted to its label (`icon-text-fit`): the box the icon spans, `[left, top, right,
	 * bottom]` from its point, before `icon-size`; `anchor` and `offset` then do not apply.
	 */
	fit?: [number, number, number, number];
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
	/**
	 * An image on its own (an `image` source), with no neighbouring tiles to close seams
	 * with: its triangles are drawn without the underlay that reaches beyond its border.
	 */
	standalone?: boolean;
}
