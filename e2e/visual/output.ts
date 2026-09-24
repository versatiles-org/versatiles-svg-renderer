/**
 * The size the regions are rendered at, and where their images go.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const WIDTH = 800;
export const HEIGHT = 600;
/**
 * The device pixel ratio of every render. The SVG gains real detail; MapLibre is told to
 * match via its map `pixelRatio` (otherwise it renders at 1x and the screenshot just
 * upscales). Anti-aliasing noise lives on edges (∝ length) while the image is area
 * (∝ size²), so a higher ratio shrinks its share of the diff without hiding real
 * differences.
 */
export const SCALE = 2;

export const outputDir = resolve(import.meta.dirname, '..', 'output');

/**
 * One folder of images per kind, each image named after its region: the three renders, and
 * the diffs of each renderer against MapLibre and against each other.
 */
export const folders = {
	maplibre: resolve(outputDir, 'maplibre'),
	svg: resolve(outputDir, 'svg'),
	png: resolve(outputDir, 'png'),
	diff: resolve(outputDir, 'diff'),
	diffPng: resolve(outputDir, 'diff-png'),
	drift: resolve(outputDir, 'drift'),
};

export function createOutputFolders(): void {
	for (const dir of Object.values(folders)) mkdirSync(dir, { recursive: true });
}
