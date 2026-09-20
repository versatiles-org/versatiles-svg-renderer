import { defineConfig, type RollupOptions } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const maplibreOnly = process.env.BUILD_TARGET === 'maplibre';

/**
 * The public `.d.ts` files carry the MapLibre style spec's types inline rather than
 * importing them. `@maplibre/maplibre-gl-style-spec` is only a devDependency — its code is
 * bundled, so there is nothing to install at runtime — which left consumers unable to
 * resolve `StyleSpecification`: with `skipLibCheck` on, `style` silently degraded to `any`
 * and lost all checking; with it off, the build failed outright.
 *
 * Those inlined types refer to the ambient `GeoJSON` namespace, which the style spec uses
 * but does not declare a dependency on, so each bundle also references `@types/geojson`
 * (a real dependency of this package, types only).
 */
const dtsPlugin = (): ReturnType<typeof dts> =>
	dts({ includeExternal: ['@maplibre/maplibre-gl-style-spec'] });
const dtsBanner = '/// <reference types="geojson" />';

const allConfigs: RollupOptions[] = [
	{
		input: 'src/index.ts',
		output: [
			{ file: 'dist/index.js', format: 'es', sourcemap: true },
			{ file: 'dist/index.cjs', format: 'cjs', sourcemap: true },
		],
		plugins: [resolve(), typescript({ tsconfig: './tsconfig.build.json' })],
	},
	{
		input: 'dist/types/index.d.ts',
		output: { file: 'dist/index.d.ts', format: 'es', banner: dtsBanner },
		plugins: [dtsPlugin()],
	},
	{
		// PNG rendering is Node-only: it needs a native canvas backend, so it gets its own
		// entry instead of living in `src/index.ts` — which `src/maplibre/index.ts`
		// re-exports, and which therefore ends up in the browser bundle. `@napi-rs/canvas`
		// stays external: it is an optional peer dependency, loaded at runtime only when
		// PNG output is actually used.
		input: 'src/png.ts',
		output: [
			{ file: 'dist/png.js', format: 'es', sourcemap: true },
			{ file: 'dist/png.cjs', format: 'cjs', sourcemap: true },
		],
		external: ['@napi-rs/canvas'],
		plugins: [resolve(), typescript({ tsconfig: './tsconfig.build.json' })],
	},
	{
		input: 'dist/types/png.d.ts',
		output: { file: 'dist/png.d.ts', format: 'es', banner: dtsBanner },
		external: ['@napi-rs/canvas'],
		plugins: [dtsPlugin()],
	},
	{
		input: 'src/maplibre/index.ts',
		output: [
			// The MapLibre control is browser-only (needs the DOM + maplibre-gl), so it
			// ships ESM (for bundlers) and UMD (for <script>) — but no CommonJS: nothing
			// `require()`s a MapLibre control from Node.
			{ file: 'dist/maplibre-svg-export.js', format: 'es', sourcemap: true },
			{
				file: 'dist/maplibre-svg-export.umd.js',
				format: 'umd',
				name: 'VersaTilesSVG',
				sourcemap: true,
				globals: { 'maplibre-gl': 'maplibregl' },
			},
		],
		external: ['maplibre-gl'],
		plugins: [resolve(), typescript({ tsconfig: './tsconfig.build.json' })],
	},
	{
		input: 'dist/types/maplibre/index.d.ts',
		output: { file: 'dist/maplibre-svg-export.d.ts', format: 'es', banner: dtsBanner },
		plugins: [dtsPlugin()],
	},
];

const maplibreConfig: RollupOptions[] = [
	{
		input: 'src/maplibre/index.ts',
		output: [{ file: 'dist/maplibre-svg-export.js', format: 'es', sourcemap: true }],
		external: ['maplibre-gl'],
		plugins: [resolve(), typescript({ tsconfig: './tsconfig.build.json' })],
	},
];

export default defineConfig(maplibreOnly ? maplibreConfig : allConfigs);
