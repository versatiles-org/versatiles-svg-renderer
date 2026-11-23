import { describe, expect, test } from 'vitest';
import { Feature, Point2D } from '../../geo/index.js';
import { mergeLines } from './merge_lines.js';

/** A street: one line, or several, named `name`, in `tile`. */
const street = (
	name: string,
	lines: [number, number][][],
	options: { tile?: string; lineContinued?: boolean[] } = {},
) =>
	new Feature({
		type: 'LineString',
		properties: { name },
		geometry: lines.map((line) => line.map(([x, y]) => new Point2D(x, y))),
		...options,
	});

const textOf = (feature: Feature) => feature.properties.name as string;
const coordinates = (features: Feature[]) =>
	features.map((feature) => feature.geometry.map((line) => line.map(({ x, y }) => [x, y])));

describe('mergeLines', () => {
	test('joins a line to the one ending where it starts, with the same text', () => {
		const merged = mergeLines(
			[
				street('A', [
					[
						[0, 0],
						[10, 0],
					],
				]),
				street('A', [
					[
						[10, 0],
						[20, 0],
					],
				]),
			],
			textOf,
		);
		expect(coordinates(merged)).toEqual([
			[
				[
					[0, 0],
					[10, 0],
					[20, 0],
				],
			],
		]);
	});

	test('joins a line before the one starting where it ends', () => {
		const merged = mergeLines(
			[
				street('A', [
					[
						[10, 0],
						[20, 0],
					],
				]),
				street('A', [
					[
						[0, 0],
						[10, 0],
					],
				]),
			],
			textOf,
		);
		expect(coordinates(merged)).toEqual([
			[
				[
					[0, 0],
					[10, 0],
					[20, 0],
				],
			],
		]);
	});

	test('joins three parts, the middle one last, to one line where the first was', () => {
		const a: [number, number][] = [
			[0, 0],
			[10, 0],
		];
		const b: [number, number][] = [
			[10, 0],
			[10, 10],
		];
		const c: [number, number][] = [
			[10, 10],
			[20, 10],
		];
		const merged = mergeLines([street('A', [a]), street('A', [c]), street('A', [b])], textOf);
		expect(coordinates(merged)).toEqual([
			[
				[
					[0, 0],
					[10, 0],
					[10, 10],
					[20, 10],
				],
			],
		]);
	});

	test('closes a ring, starting where its part joined at the front starts', () => {
		const a: [number, number][] = [
			[0, 0],
			[10, 0],
		];
		const b: [number, number][] = [
			[10, 0],
			[10, 10],
		];
		const c: [number, number][] = [
			[10, 10],
			[0, 0],
		];
		// "c" joins in front of "a", "b" then closes the ring behind it: as MapLibre joins them.
		const merged = mergeLines([street('A', [a]), street('A', [c]), street('A', [b])], textOf);
		expect(coordinates(merged)).toEqual([
			[
				[
					[10, 10],
					[0, 0],
					[10, 0],
					[10, 10],
				],
			],
		]);
	});

	test('does not join lines with other texts, in other tiles, or running the other way', () => {
		const lines = (name: string, tile?: string) => [
			street(
				name,
				[
					[
						[0, 0],
						[10, 0],
					],
				],
				{ tile },
			),
		];
		const second = [
			[
				[10, 0],
				[20, 0],
			],
		] as [number, number][][];
		expect(mergeLines([...lines('A'), street('B', second)], textOf)).toHaveLength(2);
		expect(
			mergeLines([...lines('A', '1/0/0'), street('A', second, { tile: '1/0/1' })], textOf),
		).toHaveLength(2);
		const reversed = street('A', [
			[
				[20, 0],
				[10, 0],
			],
		]);
		expect(mergeLines([...lines('A'), reversed], textOf)).toHaveLength(2);
		// Without text, nothing is joined.
		expect(mergeLines([...lines(''), street('', second)], textOf)).toHaveLength(2);
	});

	test("joins only each feature's first line, and keeps whether it goes on from the next tile", () => {
		const merged = mergeLines(
			[
				street(
					'A',
					[
						[
							[0, 0],
							[10, 0],
						],
						[
							[50, 50],
							[60, 50],
						],
					],
					{ lineContinued: [true, false] },
				),
				street(
					'A',
					[
						[
							[60, 50],
							[70, 50],
						],
					],
					{ lineContinued: [false] },
				),
				street(
					'A',
					[
						[
							[10, 0],
							[20, 0],
						],
					],
					{ lineContinued: [false] },
				),
			],
			textOf,
		);
		expect(coordinates(merged)).toEqual([
			[
				[
					[0, 0],
					[10, 0],
					[20, 0],
				],
				[
					[50, 50],
					[60, 50],
				],
			],
			[
				[
					[60, 50],
					[70, 50],
				],
			],
		]);
		expect(merged[0]!.lineContinued).toEqual([true, false]);
	});
});
