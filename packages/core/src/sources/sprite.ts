import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { defaultFetch, type FetchFunction, type FetchResponse } from './fetch.js';
import { arrayBufferToBase64 } from './base64.js';
import type { SpriteAtlas, TextFit } from '../types.js';

interface SpriteJsonEntry {
	width: number;
	height: number;
	x: number;
	y: number;
	pixelRatio?: number;
	sdf?: boolean;
	stretchX?: [number, number][];
	stretchY?: [number, number][];
	content?: [number, number, number, number];
	textFitWidth?: TextFit;
	textFitHeight?: TextFit;
}

async function fetchSpritePair(
	url: string,
	fetchFn: FetchFunction,
): Promise<{ jsonResponse: FetchResponse; imageResponse: FetchResponse } | undefined> {
	const [jsonResponse, imageResponse] = await Promise.all([
		fetchFn(`${url}.json`),
		fetchFn(`${url}.png`),
	]);
	if (jsonResponse.ok && imageResponse.ok) return { jsonResponse, imageResponse };
}

/**
 * Loads the style's sprites into one atlas. A sprite that cannot be loaded is left out,
 * so a map still renders without its icons; `complete` says whether that happened, so a
 * caller that keeps the atlas knows to retry later.
 */
export async function loadSprite(
	style: StyleSpecification,
	fetchFn: FetchFunction = defaultFetch,
): Promise<{ atlas: SpriteAtlas; complete: boolean }> {
	const atlas: SpriteAtlas = new Map();
	let complete = true;
	const sprite = style.sprite;
	if (!sprite) return { atlas, complete };

	const sources: { id: string; url: string }[] = [];
	if (typeof sprite === 'string') {
		sources.push({ id: 'default', url: sprite });
	} else if (Array.isArray(sprite)) {
		for (const s of sprite) {
			sources.push({
				id: s.id,
				url: s.url,
			});
		}
	}

	await Promise.all(
		sources.map(async ({ id, url }) => {
			try {
				// Try @2x retina sprites first, fall back to 1x
				const spritePair =
					(await fetchSpritePair(`${url}@2x`, fetchFn)) ?? (await fetchSpritePair(url, fetchFn));
				if (!spritePair) {
					complete = false;
					return;
				}
				const { jsonResponse, imageResponse } = spritePair;

				const json = (await jsonResponse.json()) as Record<string, SpriteJsonEntry>;
				const imageBuffer = await imageResponse.arrayBuffer();
				const sheetDataUri = `data:image/png;base64,${arrayBufferToBase64(imageBuffer)}`;

				// Estimate sheet dimensions from sprite entries
				let sheetWidth = 0;
				let sheetHeight = 0;
				for (const entry of Object.values(json)) {
					sheetWidth = Math.max(sheetWidth, entry.x + entry.width);
					sheetHeight = Math.max(sheetHeight, entry.y + entry.height);
				}

				const prefix = id === 'default' ? '' : `${id}:`;
				for (const [name, entry] of Object.entries(json)) {
					atlas.set(`${prefix}${name}`, {
						width: entry.width,
						height: entry.height,
						x: entry.x,
						y: entry.y,
						pixelRatio: entry.pixelRatio ?? 1,
						sdf: entry.sdf ?? false,
						sheetDataUri,
						sheetWidth,
						sheetHeight,
						...(entry.stretchX && { stretchX: entry.stretchX }),
						...(entry.stretchY && { stretchY: entry.stretchY }),
						...(entry.content && { content: entry.content }),
						...(entry.textFitWidth && { textFitWidth: entry.textFitWidth }),
						...(entry.textFitHeight && { textFitHeight: entry.textFitHeight }),
					});
				}
			} catch {
				// Silently skip failed sprite loads
				complete = false;
			}
		}),
	);

	return { atlas, complete };
}

export async function loadSpriteAtlas(
	style: StyleSpecification,
	fetchFn: FetchFunction = defaultFetch,
): Promise<SpriteAtlas> {
	return (await loadSprite(style, fetchFn)).atlas;
}
