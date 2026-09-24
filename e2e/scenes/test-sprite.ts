/**
 * A sprite made for the e2e tests, with what the VersaTiles sprites do not have: images
 * that stretch (`stretchX`, `stretchY`, `content`), for `icon-text-fit`.
 *
 * It is a fixture (see `fixtures.ts`), drawn when first asked for: MapLibre (in the
 * browser) and the renderers (in Node) both load it from there.
 */
import { createCanvas } from '@napi-rs/canvas';
import { addFixture, FIXTURES_URL } from '../fixtures.js';

/**
 * The sprite's images, at a pixel ratio of 1 (drawn large, for the diffs to show), 4
 * pixels apart as sprite tools pad them: scaled or turned, an image would otherwise show a
 * trace of its neighbour at its edge.
 */
const images = {
	// A shield: a frame with differently coloured sides and corners, so a stretched corner
	// or side shows. The frame stretches between the corners; the content is inside it.
	shield: {
		x: 0,
		y: 0,
		width: 48,
		height: 40,
		pixelRatio: 1,
		stretchX: [[12, 36]],
		stretchY: [[12, 28]],
		content: [8, 8, 40, 32],
	},
	// A plain image, stretched as a whole: a checkerboard of 4 × 4 squares.
	plain: { x: 52, y: 0, width: 32, height: 32, pixelRatio: 1 },
	// An arrow pointing right, to see which way an icon is turned.
	arrow: { x: 88, y: 0, width: 32, height: 20, pixelRatio: 1 },
};

function drawSheet(): Buffer {
	const canvas = createCanvas(120, 40);
	const ctx = canvas.getContext('2d');

	// Shield: a dark frame with a red left side, a blue right side and a yellow top-left
	// corner; a white inside.
	ctx.fillStyle = '#1a3a6b';
	ctx.fillRect(0, 0, 48, 40);
	ctx.fillStyle = '#d7191c';
	ctx.fillRect(0, 12, 6, 16);
	ctx.fillStyle = '#2c7bb6';
	ctx.fillRect(42, 12, 6, 16);
	ctx.fillStyle = '#fdae61';
	ctx.fillRect(0, 0, 10, 10);
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(6, 6, 36, 28);

	// Plain: a checkerboard.
	for (let y = 0; y < 8; y++) {
		for (let x = 0; x < 8; x++) {
			ctx.fillStyle = (x + y) % 2 === 0 ? '#1b7837' : '#d9f0d3';
			ctx.fillRect(52 + x * 4, y * 4, 4, 4);
		}
	}

	// Arrow: a shaft and a head, pointing right.
	ctx.fillStyle = '#762a83';
	ctx.fillRect(88, 7, 18, 6);
	ctx.beginPath();
	ctx.moveTo(104, 0);
	ctx.lineTo(120, 10);
	ctx.lineTo(104, 20);
	ctx.closePath();
	ctx.fill();

	return canvas.toBuffer('image/png');
}

/** The sprite's URL, as a style names it (a renderer adds `@2x`, `.json`, `.png`). */
export const TEST_SPRITE_URL = new URL('sprites/test', FIXTURES_URL).href;

let sheet: Buffer | undefined;
for (const suffix of ['@2x', '']) {
	addFixture(`sprites/test${suffix}.json`, 'application/json', () =>
		Buffer.from(JSON.stringify(images)),
	);
	addFixture(`sprites/test${suffix}.png`, 'image/png', () => (sheet ??= drawSheet()));
}
