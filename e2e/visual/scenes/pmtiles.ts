/**
 * The VersaTiles style, with its tiles read from a PMTiles archive (`pmtiles://…`) instead
 * of the tile server: the tiles around a view, fetched once and written into an archive,
 * which is served as a fixture. Drawn alike, the region shows that the renderers read the
 * archive as MapLibre does with the `pmtiles` protocol. With `encoding: 'mlt'`, the tiles
 * are converted to MLT (MapLibre Tiles) first, and the source says so, as MapLibre needs.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { addFixture } from '../../shared/fixtures.js';
import { mvtToMLT } from '../../shared/mvt-to-mlt.js';
import { type ArchiveTile, writePMTiles } from '../../shared/pmtiles-writer.js';
import type { View } from '../regions.js';

/** How many tiles the archive holds beyond the one at the view's center, in each direction. */
const MARGIN = 2;

/** `style` with its vector source replaced by an archive of the tiles `view` shows. */
export async function pmtilesStyle(
	style: StyleSpecification,
	view: View,
	encoding: 'mvt' | 'mlt' = 'mvt',
): Promise<StyleSpecification> {
	const [name, source] = Object.entries(style.sources).find(([, s]) => s.type === 'vector')!;
	const { tiles: templates, maxzoom = 14 } = source as { tiles: string[]; maxzoom?: number };
	const z = Math.min(Math.floor(view.zoom), maxzoom);
	const centerX = Math.floor(((view.lon + 180) / 360) * 2 ** z);
	const latRad = (view.lat * Math.PI) / 180;
	const centerY = Math.floor(
		((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z,
	);

	const requests: Promise<ArchiveTile | undefined>[] = [];
	for (let x = centerX - MARGIN; x <= centerX + MARGIN; x++) {
		for (let y = centerY - MARGIN; y <= centerY + MARGIN; y++) {
			const url = templates[0]!
				.replace('{z}', String(z))
				.replace('{x}', String(x))
				.replace('{y}', String(y));
			requests.push(
				fetch(url).then(async (response) => {
					if (!response.ok) return undefined;
					const data = new Uint8Array(await response.arrayBuffer());
					return { z, x, y, data: encoding === 'mlt' ? mvtToMLT(data) : data };
				}),
			);
		}
	}
	const tiles = (await Promise.all(requests)).filter((tile) => tile !== undefined);
	const url = addFixture(
		`pmtiles/${encoding}-${String(z)}-${String(centerX)}-${String(centerY)}.pmtiles`,
		'application/octet-stream',
		writePMTiles(tiles, encoding),
	);
	return {
		...style,
		sources: {
			...style.sources,
			[name]: {
				type: 'vector',
				url: `pmtiles://${url}`,
				...(encoding === 'mlt' ? { encoding: 'mlt' as const } : {}),
			},
		},
	};
}
