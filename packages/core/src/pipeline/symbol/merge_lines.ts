/**
 * Lines with the same text joined where they meet, as MapLibre GL JS joins them before it
 * places labels along lines (`merge_lines.ts`): a street split into several ways, such as
 * the arcs of a roundabout, is then one line that a label fits on.
 */
import { Feature, type Point2D } from '../../geo/index.js';

/** A run of a line's points, and the run joined after it. */
interface Chunk {
	points: Point2D[];
	/** Whether the run starts on its tile's border (see `Feature.lineContinued`). */
	continued: boolean;
	next: Chunk | undefined;
}

interface MergedLine {
	feature: Feature;
	first: Chunk;
	last: Chunk;
	/** Joined into another line, and so left out. */
	gone?: boolean;
}

/**
 * `features` with the first line of each joined to the first line of another with the same
 * text (`textOf`) in the same tile, where one ends at the point the other starts, as MapLibre
 * does: only the first line of each feature, and only end to start, never reversed. In the
 * order of the features, each joined line where its first part was.
 */
export function mergeLines(features: Feature[], textOf: (feature: Feature) => string): Feature[] {
	const leftIndex = new Map<string, number>();
	const rightIndex = new Map<string, number>();
	const merged: MergedLine[] = [];
	const keyOf = (feature: Feature, text: string, point: Point2D): string =>
		`${feature.tile ?? ''}\0${text}\0${String(point.x)},${String(point.y)}`;

	for (const feature of features) {
		const text = textOf(feature);
		const points = feature.geometry[0];
		if (!text || !points || points.length === 0) {
			merged.push(lineOf(feature));
			continue;
		}
		const line = lineOf(feature);
		const leftKey = keyOf(feature, text, points[0]!);
		const rightKey = keyOf(feature, text, points[points.length - 1]!);
		const before = rightIndex.get(leftKey);
		const after = leftIndex.get(rightKey);
		if (before !== undefined && after !== undefined && before !== after) {
			// Between two lines: joins both.
			const j = mergeFromLeft(merged, leftIndex, leftKey, rightKey, line);
			const i = mergeFromRight(merged, rightIndex, leftKey, rightKey, merged[j]!);
			leftIndex.delete(leftKey);
			rightIndex.delete(rightKey);
			const target = merged[i]!;
			const end = target.last.points[target.last.points.length - 1]!;
			rightIndex.set(keyOf(feature, text, end), i);
			merged[j]!.gone = true;
		} else if (before !== undefined) {
			mergeFromRight(merged, rightIndex, leftKey, rightKey, line);
		} else if (after !== undefined) {
			mergeFromLeft(merged, leftIndex, leftKey, rightKey, line);
		} else {
			const i = merged.push(line) - 1;
			leftIndex.set(leftKey, i);
			rightIndex.set(rightKey, i);
		}
	}

	return merged
		.filter((line) => !line.gone)
		.map((line) => {
			if (!line.first.next) return line.feature;
			const { feature } = line;
			return new Feature({
				type: feature.type,
				id: feature.id,
				properties: feature.properties,
				patterns: feature.patterns,
				geometry: [joinChunks(line), ...feature.geometry.slice(1)],
				lineContinued: feature.lineContinued && [
					line.first.continued,
					...feature.lineContinued.slice(1),
				],
				tile: feature.tile,
			});
		});
}

function lineOf(feature: Feature): MergedLine {
	const chunk: Chunk = {
		points: feature.geometry[0] ?? [],
		continued: feature.lineContinued?.[0] ?? false,
		next: undefined,
	};
	return { feature, first: chunk, last: chunk };
}

/** The points of all of a line's chunks, each shared point once. */
function joinChunks(line: MergedLine): Point2D[] {
	const points = [...line.first.points];
	for (let chunk = line.first.next; chunk; chunk = chunk.next)
		points.push(...chunk.points.slice(1));
	return points;
}

/** Appends `line` to the line that ends where it starts. */
function mergeFromRight(
	merged: MergedLine[],
	rightIndex: Map<string, number>,
	leftKey: string,
	rightKey: string,
	line: MergedLine,
): number {
	const i = rightIndex.get(leftKey)!;
	rightIndex.delete(leftKey);
	rightIndex.set(rightKey, i);
	const target = merged[i]!;
	target.last.next = line.first;
	target.last = line.last;
	return i;
}

/** Prepends `line` to the line that starts where it ends. */
function mergeFromLeft(
	merged: MergedLine[],
	leftIndex: Map<string, number>,
	leftKey: string,
	rightKey: string,
	line: MergedLine,
): number {
	const i = leftIndex.get(rightKey)!;
	leftIndex.delete(rightKey);
	leftIndex.set(leftKey, i);
	const target = merged[i]!;
	line.last.next = target.first;
	target.first = line.first;
	return i;
}
