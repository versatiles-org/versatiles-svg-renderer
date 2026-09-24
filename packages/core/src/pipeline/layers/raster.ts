import { getRasterTiles } from '../../sources/index.js';
import { evaluateLayer, type Layer } from './layer.js';

export async function renderRasterLayer(layer: Layer): Promise<void> {
	const { job, context, layerStyle } = layer;
	const tiles = await getRasterTiles(job, layerStyle.source, context.loadTile);
	const { getPaint } = evaluateLayer(layer);
	await job.renderer.drawRasterTiles(layerStyle.id, tiles, {
		opacity: getPaint('raster-opacity') as number,
		hueRotate: getPaint('raster-hue-rotate') as number,
		brightnessMin: getPaint('raster-brightness-min') as number,
		brightnessMax: getPaint('raster-brightness-max') as number,
		saturation: getPaint('raster-saturation') as number,
		contrast: getPaint('raster-contrast') as number,
		resampling: getPaint('raster-resampling') as 'linear' | 'nearest',
	});
}
