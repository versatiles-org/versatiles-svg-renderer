import type { Color as MaplibreColor, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from '../geometry.js';
import type { SpriteAtlas } from '../sources/sprite.js';

export interface View {
	center: [number, number];
	zoom: number;
}

export interface Renderer {
	readonly width: number;
	readonly height: number;
	drawBackgroundFill(style: BackgroundStyle): void;
	drawPolygons(id: string, features: [Feature, FillStyle][]): void;
	drawLineStrings(id: string, features: [Feature, LineStyle][]): void;
	drawCircles(id: string, features: [Feature, CircleStyle][]): void;
	drawLabels(id: string, features: [Feature, SymbolStyle][]): void;
	drawIcons(id: string, features: [Feature, IconStyle][], spriteAtlas: SpriteAtlas): void;
	drawRasterTiles(id: string, tiles: RasterTile[], style: RasterStyle): void;
	getString(): string;
}

export interface RenderJob {
	style: StyleSpecification;
	view: View;
	renderer: Renderer;
	renderLabels?: boolean;
}

export interface RendererOptions {
	width: number;
	height: number;
}

export interface BackgroundStyle {
	color: MaplibreColor;
	opacity: number;
}

export interface FillStyle {
	color: MaplibreColor;
	opacity: number;
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
	opacity: number;
	radius: number;
	translate: [number, number];
	strokeWidth: number;
	strokeColor: MaplibreColor;
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

export interface SymbolStyle {
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
}
