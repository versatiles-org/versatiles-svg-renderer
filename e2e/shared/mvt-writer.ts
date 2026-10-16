/**
 * Writes a vector tile (MVT) of polygons, so a scene can draw tiles it makes itself: just
 * enough of the format for that, with one ring per polygon and string properties only.
 */
import { PbfWriter } from 'pbf';

export interface TilePolygon {
	/** The ring, in tile units (0..4096), clockwise on the screen; it is closed when written. */
	ring: [number, number][];
	properties: Record<string, string>;
}

/** A tile of one layer, `name`, holding `polygons`. */
export function writeMVT(name: string, polygons: TilePolygon[]): Uint8Array {
	const keys: string[] = [];
	const values: string[] = [];
	const index = (list: string[], item: string): number => {
		if (!list.includes(item)) list.push(item);
		return list.indexOf(item);
	};
	const features = polygons.map(({ ring, properties }) => ({
		tags: Object.entries(properties).flatMap(([key, value]) => [
			index(keys, key),
			index(values, value),
		]),
		geometry: encodeRing(ring),
	}));

	const pbf = new PbfWriter();
	pbf.writeMessage(
		3,
		(_, layer) => {
			layer.writeVarintField(15, 2); // version
			layer.writeStringField(1, name);
			for (const feature of features) {
				layer.writeMessage(
					2,
					({ tags, geometry }, message) => {
						message.writePackedVarint(2, tags);
						message.writeVarintField(3, 3); // type: polygon
						message.writePackedVarint(4, geometry);
					},
					feature,
				);
			}
			for (const key of keys) layer.writeStringField(3, key);
			for (const value of values) {
				layer.writeMessage(4, (text, message) => message.writeStringField(1, text), value);
			}
			layer.writeVarintField(5, 4096); // extent
		},
		undefined,
	);
	return pbf.finish();
}

/** The commands of a ring: move to its first point, a line to each other, close it. */
function encodeRing(ring: [number, number][]): number[] {
	const zigzag = (n: number): number => (n << 1) ^ (n >> 31);
	const commands: number[] = [];
	let [x, y] = [0, 0];
	ring.forEach(([px, py], i) => {
		if (i === 0) commands.push((1 << 3) | 1);
		if (i === 1) commands.push(((ring.length - 1) << 3) | 2);
		commands.push(zigzag(px - x), zigzag(py - y));
		[x, y] = [px, py];
	});
	commands.push((1 << 3) | 7);
	return commands;
}
