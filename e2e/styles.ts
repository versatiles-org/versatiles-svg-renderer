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

	{ name: 'berlin', lon: 13.388, lat: 52.517, zoom: 14, type: 'geojson' },
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
				style.layers.push(
					{
						id: 'geojson-fill',
						type: 'fill',
						source: 'geojson-overlay',
						paint: {
							'fill-color': '#00ff00',
							'fill-opacity': 0.3,
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
							'circle-stroke-color': '#ffffff',
						},
					},
				);
				break;
		}
		styleCache.set(type, style);
	}
	return style;
}
