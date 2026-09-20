import { defineConfig, type RollupOptions } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const maplibreOnly = process.env.BUILD_TARGET === 'maplibre';

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
		output: { file: 'dist/index.d.ts', format: 'es' },
		plugins: [dts()],
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
		output: { file: 'dist/png.d.ts', format: 'es' },
		external: ['@napi-rs/canvas'],
		plugins: [dts()],
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
		output: { file: 'dist/maplibre-svg-export.d.ts', format: 'es' },
		plugins: [dts()],
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
