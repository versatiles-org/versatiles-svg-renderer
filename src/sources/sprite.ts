import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { arrayBufferToBase64 } from './base64.js';

export interface SpriteEntry {
	width: number;
	height: number;
	x: number;
	y: number;
	pixelRatio: number;
	sdf: boolean;
	sheetDataUri: string;
	sheetWidth: number;
	sheetHeight: number;
}

export type SpriteAtlas = Map<string, SpriteEntry>;

interface SpriteJsonEntry {
	width: number;
	height: number;
	x: number;
	y: number;
	pixelRatio?: number;
	sdf?: boolean;
}

async function fetchSpritePair(
	url: string,
): Promise<{ jsonResponse: Response; imageResponse: Response } | undefined> {
	const [jsonResponse, imageResponse] = await Promise.all([
		fetch(`${url}.json`),
		fetch(`${url}.png`),
	]);
	if (jsonResponse.ok && imageResponse.ok) return { jsonResponse, imageResponse };
}

export async function loadSpriteAtlas(style: StyleSpecification): Promise<SpriteAtlas> {
	const atlas: SpriteAtlas = new Map();
	const sprite = style.sprite;
	if (!sprite) return atlas;

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
				const spritePair = (await fetchSpritePair(`${url}@2x`)) ?? (await fetchSpritePair(url));
				if (!spritePair) return;
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
					});
				}
			} catch {
				// Silently skip failed sprite loads
			}
		}),
	);

	return atlas;
}
