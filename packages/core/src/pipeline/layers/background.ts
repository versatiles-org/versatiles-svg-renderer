import type { Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { evaluateLayer, resolvePattern, type Layer } from './layer.js';

export async function renderBackgroundLayer(layer: Layer): Promise<void> {
	const { getPaint } = evaluateLayer(layer);
	const pattern = resolvePattern(layer, getPaint('background-pattern'));
	// A pattern whose image is not in the sprite draws nothing, as in MapLibre.
	if (pattern === null) return;
	await layer.job.renderer.drawBackgroundFill({
		color: getPaint('background-color') as MaplibreColor,
		opacity: getPaint('background-opacity') as number,
		pattern,
	});
}
