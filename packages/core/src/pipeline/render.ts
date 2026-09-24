import { Projection } from '../geo/index.js';
import type { Renderer, RenderJob, SpriteAtlas, StringRenderer } from '../types.js';
import { getLayerFeatures } from '../sources/index.js';
import { createRenderContext, type RenderContext } from './context.js';
import type { StyleLayer } from './style_layer.js';
import {
	placeSymbolLayers,
	renderBackgroundLayer,
	renderCircleLayer,
	renderFillLayer,
	renderLineLayer,
	renderRasterLayer,
	renderSymbolLayer,
	type Layer,
} from './layers/index.js';

/**
 * Draws the map described by `job` onto its renderer and returns that renderer, so a
 * caller can take the result in whatever form the backend provides (see
 * {@link renderMap} for the SVG string, or `renderToPNG` in `@versatiles/png-renderer` for
 * an image buffer).
 *
 * `context` must have been created for `job.style`; without one, a fresh one is made.
 */
export async function drawMap<R extends Renderer>(
	job: RenderJob<R>,
	context: RenderContext = createRenderContext(job.style),
): Promise<R> {
	job.projection ??= Projection.fromStyle({
		width: job.renderer.width,
		height: job.renderer.height,
		center: job.view.center,
		zoom: job.view.zoom,
		projection: job.style.projection,
		bearing: job.view.bearing,
		padding: job.view.padding,
	});
	const clipCircle = job.projection.clipCircle;
	if (clipCircle) job.renderer.setClipCircle?.(clipCircle);
	const sources = await context.getSources();
	await render({ ...job, style: { ...job.style, sources } }, context);
	job.renderer.finish?.();
	return job.renderer;
}

export async function renderMap(
	job: RenderJob<StringRenderer>,
	context?: RenderContext,
): Promise<string> {
	return (await drawMap(job, context)).getString();
}

async function render(job: RenderJob, context: RenderContext): Promise<void> {
	// The sprite holds the icons, and the images of patterns.
	const needsSprite =
		(job.labels ?? 'none') !== 'none' ||
		context.layers.some((layer) => layer.usesPattern && !layer.isHidden(job.view.zoom));
	const [sourceFeatures, spriteAtlas] = await Promise.all([
		getLayerFeatures(job, context.loadTile),
		needsSprite ? context.getSprite() : Promise.resolve(new Map() as SpriteAtlas),
	]);
	const availableImages: string[] = [...spriteAtlas.keys()];
	const makeLayer = (layerStyle: StyleLayer): Layer => ({
		job,
		context,
		layerStyle,
		sourceFeatures,
		spriteAtlas,
		availableImages,
	});

	// Labels and icons are placed before anything is drawn.
	const symbols = await placeSymbolLayers(job, context.layers, makeLayer);

	for (const layerStyle of context.layers) {
		if (layerStyle.isHidden(job.view.zoom)) continue;

		// One function per layer type. Besides keeping each short, this lets a CPU profile
		// tell the layer types apart: `npm run bench` divides the time by these functions.
		const layer = makeLayer(layerStyle);
		switch (layerStyle.type) {
			case 'background':
				await renderBackgroundLayer(layer);
				continue;
			case 'fill':
				await renderFillLayer(layer);
				continue;
			case 'line':
				await renderLineLayer(layer);
				continue;
			case 'raster':
				await renderRasterLayer(layer);
				continue;
			case 'circle':
				renderCircleLayer(layer);
				continue;
			case 'symbol':
				await renderSymbolLayer(layer, symbols.get(layerStyle) ?? []);
				continue;
			case 'color-relief':
			case 'fill-extrusion':
			case 'heatmap':
			case 'hillshade':
				continue;
			default:
				throw Error('layerStyle.type: ' + String(layerStyle.type));
		}
	}
}
