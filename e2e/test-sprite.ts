/**
 * A sprite made for the e2e tests, with what the VersaTiles sprites do not have: images
 * that stretch (`stretchX`, `stretchY`, `content`), for `icon-text-fit`.
 *
 * It is drawn here and put into the fetch cache under a URL that does not exist, so that
 * MapLibre (in the browser) and the renderers (in Node) both load it from there.
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeCache } from './fetch-cache.js';

export const TEST_SPRITE_URL = 'https://e2e.invalid/sprites/test';

/**
 * The sprite's images, at a pixel ratio of 2, 4 pixels apart as sprite tools pad them:
 * scaled or turned, an image would otherwise show a trace of its neighbour at its edge.
 */
const images = {
	// A shield: a frame with differently coloured sides and corners, so a stretched corner
	// or side shows. The frame stretches between the corners; the content is inside it.
	shield: {
		x: 0,
		y: 0,
		width: 48,
		height: 40,
		pixelRatio: 2,
		stretchX: [[12, 36]],
		stretchY: [[12, 28]],
		content: [8, 8, 40, 32],
	},
	// A plain image, stretched as a whole: a checkerboard of 4 × 4 squares.
	plain: { x: 52, y: 0, width: 32, height: 32, pixelRatio: 2 },
	// An arrow pointing right, to see which way an icon is turned.
	arrow: { x: 88, y: 0, width: 32, height: 20, pixelRatio: 2 },
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

/** Puts the sprite into the fetch cache, at both resolutions a renderer may ask for. */
export function seedTestSprite(): void {
	const json = Buffer.from(JSON.stringify(images)).toString('base64');
	const png = drawSheet().toString('base64');
	for (const suffix of ['@2x', '']) {
		writeCache(`${TEST_SPRITE_URL}${suffix}.json`, {
			status: 200,
			contentType: 'application/json',
			body: json,
		});
		writeCache(`${TEST_SPRITE_URL}${suffix}.png`, {
			status: 200,
			contentType: 'image/png',
			body: png,
		});
	}
}
