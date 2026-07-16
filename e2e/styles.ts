import { styles } from '@versatiles/style';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Feature } from 'geojson';
import { LineLayerSpecification } from 'maplibre-gl';

export interface Region {
	name: string;
	lon: number;
	lat: number;
	zoom: number;
	type: 'vector' | 'satellite' | 'geojson';
}

export const regions: Region[] = [
	{ name: 'berlin', lon: 13.357, lat: 52.515, zoom: 14.2, type: 'vector' },
	{ name: 'paris', lon: 2.295, lat: 48.858, zoom: 14.9, type: 'vector' },
	{ name: 'warsaw', lon: 21.013, lat: 52.249, zoom: 14.9, type: 'vector' },
	{ name: 'tokyo', lon: 139.692, lat: 35.69, zoom: 10, type: 'vector' },
	{ name: 'roma', lon: 12.489, lat: 41.89, zoom: 14.9, type: 'vector' },
	{ name: 'sao-paulo', lon: -46.635, lat: -23.548, zoom: 14, type: 'vector' },

	{ name: 'berlin', lon: 13.376, lat: 52.518, zoom: 15, type: 'satellite' },

	{ name: 'berlin', lon: 13.388, lat: 52.514, zoom: 14, type: 'geojson' },
];

export function regionId(region: Region): string {
	return `${region.name}-${region.type}`;
}

const styleCache = new Map<string, StyleSpecification>();
export async function getStyle(type: Region['type']): Promise<StyleSpecification> {
	let style = styleCache.get(type);
	if (!style) {
		switch (type) {
			case 'vector':
				style = styles.colorful({ hideLabels: true });
				break;
			case 'satellite':
				style = await styles.satellite({ overlay: false });
				break;
			case 'geojson':
				style = {
					version: 8,
					sources: {},
					layers: [
						{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
					],
				};
				style.sources['geojson-overlay'] = {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Polygon',
								coordinates: [
									[
										[13.38, 52.52],
										[13.39, 52.52],
										[13.39, 52.514],
										[13.38, 52.514],
										[13.38, 52.52],
									],
									[
										[13.383, 52.518],
										[13.387, 52.518],
										[13.387, 52.516],
										[13.383, 52.516],
										[13.383, 52.518],
									],
								],
							},
							{
								type: 'LineString',
								coordinates: [
									[13.391, 52.515],
									[13.392, 52.519],
									[13.393, 52.516],
									[13.394, 52.519],
									[13.395, 52.515],
								],
							},
							...(
								[
									[13.399, 52.519],
									[13.398, 52.517],
									[13.397, 52.515],
								] as [number, number][]
							).map((coordinates) => ({
								type: 'Point',
								coordinates,
							})),
						].map(
							(geometry) =>
								({
									type: 'Feature',
									properties: {},
									geometry,
								}) as Feature,
						),
					},
				};
				// Isolated west->east line for validating line-offset direction and line-blur
				// against MapLibre (kept separate from the polygon so ring rewinding does not
				// affect the offset side).
				style.sources['geojson-lines'] = {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [
								[13.382, 52.512],
								[13.392, 52.512],
							],
						},
					},
				};
				// Six overlapping rectangles cascading diagonally, each a different rainbow
				// color via data-driven `fill-color`. Checks data-driven paint and that
				// overlapping fills paint in source order (last on top) like MapLibre.
				// (The run-length grouping itself is unit-tested in svg.test.ts.)
				style.sources['geojson-stack'] = {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: (
							['#ff0000', '#ff8800', '#ffdd00', '#00bb00', '#0077ff', '#8800dd'] as string[]
						).map((color, i) => {
							const lon = 13.379 + i * 0.0012;
							const lat = 52.51 - i * 0.0002;
							return {
								type: 'Feature',
								properties: { color },
								geometry: {
									type: 'Polygon',
									coordinates: [
										[
											[lon, lat],
											[lon + 0.004, lat],
											[lon + 0.004, lat - 0.0025],
											[lon, lat - 0.0025],
											[lon, lat],
										],
									],
								},
							};
						}),
					},
				};
				style.layers.push(
					{
						id: 'geojson-fill',
						type: 'fill',
						source: 'geojson-overlay',
						paint: {
							'fill-color': '#00aaaa',
							'fill-opacity': 0.3,
						},
					},
					{
						id: 'geojson-stack',
						type: 'fill',
						source: 'geojson-stack',
						paint: {
							'fill-color': ['get', 'color'],
							// Explicit choropleth-style border. MapLibre draws each rectangle's
							// outline over ALL fills, so a lower rectangle's white edge shows on
							// top of a later overlapping fill — the parity case for fill-outline-color.
							'fill-outline-color': '#ffffff',
						},
					},
					{
						id: 'geojson-line',
						type: 'line',
						source: 'geojson-overlay',
						paint: {
							'line-color': '#0000ff',
							'line-width': 4,
						},
					},
					{
						id: 'geojson-line-offset',
						type: 'line',
						source: 'geojson-lines',
						paint: {
							'line-color': '#ff8800',
							'line-width': 2,
							'line-offset': -20,
						},
					},
					...([2, 5, 10, 20].map((blur, index) => ({
						id: `geojson-line-blur-${blur}`,
						type: 'line',
						source: 'geojson-lines',
						paint: {
							'line-color': '#0000cc',
							'line-width': 10,
							'line-offset': index * 20,
							'line-blur': blur,
						},
					})) as LineLayerSpecification[]),
					{
						id: 'geojson-circle',
						type: 'circle',
						source: 'geojson-overlay',
						paint: {
							'circle-radius': 8,
							'circle-color': '#cc0000',
							'circle-stroke-width': 2,
							'circle-stroke-color': '#00cc00',
						},
					},
				);
				break;
		}
		styleCache.set(type, style);
	}
	return style;
}
