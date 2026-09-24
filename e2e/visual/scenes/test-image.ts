/**
 * An image made for the e2e tests, for `image` sources: four quadrants, each a checkerboard
 * of its colour and white, so a warped, flipped or turned image shows in the diff. Large
 * squares keep the browsers' different resampling from dominating the diff.
 *
 * It is a fixture (see `fixtures.ts`), drawn when first asked for: MapLibre (in the
 * browser) and the renderers (in Node) both load it from there.
 */
import { createCanvas } from '@napi-rs/canvas';
import { addFixture } from '../../shared/fixtures.js';

const WIDTH = 128;
const HEIGHT = 96;
const SQUARE = 16;

/** Top left, top right, bottom left, bottom right. */
const COLORS = ['#d7191c', '#1b7837', '#2c7bb6', '#fdae61'];

function drawImage(): Buffer {
	const canvas = createCanvas(WIDTH, HEIGHT);
	const ctx = canvas.getContext('2d');
	for (let y = 0; y < HEIGHT / SQUARE; y++) {
		for (let x = 0; x < WIDTH / SQUARE; x++) {
			const quadrant = (y < HEIGHT / SQUARE / 2 ? 0 : 2) + (x < WIDTH / SQUARE / 2 ? 0 : 1);
			ctx.fillStyle = (x + y) % 2 === 0 ? COLORS[quadrant]! : '#ffffff';
			ctx.fillRect(x * SQUARE, y * SQUARE, SQUARE, SQUARE);
		}
	}
	return canvas.toBuffer('image/png');
}

let image: Buffer | undefined;

/** The image's URL. */
export const TEST_IMAGE_URL = addFixture(
	'images/test.png',
	'image/png',
	() => (image ??= drawImage()),
);
