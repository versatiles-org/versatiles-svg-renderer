/**
 * Polygons that go on from tile to tile: each tile holds a sea and land over it, reaching
 * into its buffer, drawn in one fill layer on a dark background, like a map whose land
 * polygons are stacked over a sea polygon (#63's Golarion map). Seen at a zoom level where the
 * tile borders run through the middle of pixels, a fill that ends on a tile border lets the
 * sea and the background show through there: a line along the tile border, which MapLibre
 * does not draw.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { addFixture, FIXTURES_URL } from '../../shared/fixtures.js';
import { writeMVT } from '../../shared/mvt-writer.js';

/** The zoom level of the tiles, and how many around the center tile are served. */
const Z = 12;
const MARGIN = 2;

export function seamsStyle(): StyleSpecification {
	const buffer = 128;
	const ring: [number, number][] = [
		[-buffer, -buffer],
		[4096 + buffer, -buffer],
		[4096 + buffer, 4096 + buffer],
		[-buffer, 4096 + buffer],
	];
	const tile = Buffer.from(
		writeMVT('areas', [
			{ ring, properties: { kind: 'sea' } },
			{ ring, properties: { kind: 'land' } },
		]),
	);
	// The same tile everywhere around 0°/0°, where the regions of the scenes look.
	const center = 2 ** (Z - 1);
	for (let x = center - MARGIN; x < center + MARGIN; x++) {
		for (let y = center - MARGIN; y < center + MARGIN; y++) {
			addFixture(
				`seams/${String(Z)}/${String(x)}/${String(y)}.mvt`,
				'application/x-protobuf',
				tile,
			);
		}
	}
	return {
		version: 8,
		sources: {
			areas: {
				type: 'vector',
				tiles: [`${FIXTURES_URL}seams/{z}/{x}/{y}.mvt`],
				minzoom: Z,
				maxzoom: Z,
			},
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': '#202020' } },
			{
				id: 'areas',
				type: 'fill',
				source: 'areas',
				'source-layer': 'areas',
				paint: {
					'fill-color': ['match', ['get', 'kind'], 'sea', '#2060ff', '#f8f1e1'],
				},
			},
		],
	};
}
