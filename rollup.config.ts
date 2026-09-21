import { defineConfig, type RollupOptions } from 'rollup';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

/**
 * Builds every published package into its own `packages/<name>/dist/`.
 *
 * Each package bundles the private `@versatiles/renderer-core` workspace package, so none
 * of them depends on another at runtime. All outputs are ES modules, except the MapLibre
 * plugin's additional UMD build: a classic `<script>` for browsers, CDNs and
 * versatiles-frontend, which exposes the `VersaTilesSVG` global.
 *
 * Set `PACKAGE` to build a single package, e.g. `--environment PACKAGE:maplibre-svg-export`
 * (used by `dev/serve.ts`).
 */

/**
 * The public `.d.ts` files carry the MapLibre style spec's types inline rather than
 * importing them. `@maplibre/maplibre-gl-style-spec` is only a devDependency — its code is
 * bundled, so there is nothing to install at runtime — which left consumers unable to
 * resolve `StyleSpecification`: with `skipLibCheck` on, `style` silently degraded to `any`
 * and lost all checking; with it off, the build failed outright. The renderer core is
 * inlined for the same reason: it is never published.
 *
 * Those inlined types refer to the ambient `GeoJSON` namespace, which the style spec uses
 * but does not declare a dependency on, so each bundle also references `@types/geojson`
 * (a real dependency of every package, types only).
 */
const dtsPlugin = (): ReturnType<typeof dts> =>
	dts({
		includeExternal: ['@maplibre/maplibre-gl-style-spec', '@versatiles/renderer-core'],
		tsconfig: './tsconfig.build.json',
	});
const dtsBanner = '/// <reference types="geojson" />';

const tsPlugin = (): ReturnType<typeof typescript> =>
	typescript({ tsconfig: './tsconfig.build.json' });

/** The ES module build and the bundled type declarations of one package. */
function packageConfigs(
	dir: string,
	name: string,
	options: { external?: string[]; extraOutputs?: RollupOptions['output'][] } = {},
): RollupOptions[] {
	const input = `packages/${dir}/src/index.ts`;
	const external = options.external ?? [];
	return [
		{
			input,
			output: [
				{ file: `packages/${dir}/dist/${name}.js`, format: 'es', sourcemap: true },
				...(options.extraOutputs ?? []).flat().filter((o) => o !== undefined),
			],
			external,
			plugins: [resolve(), tsPlugin()],
		},
		{
			input,
			output: { file: `packages/${dir}/dist/${name}.d.ts`, format: 'es', banner: dtsBanner },
			external,
			plugins: [dtsPlugin()],
		},
	];
}

const packages: Record<string, RollupOptions[]> = {
	'svg-renderer': packageConfigs('svg-renderer', 'index'),

	// `@napi-rs/canvas` stays external: it is a dependency of this package, a native module,
	// and loaded at runtime only when PNG output is actually used.
	'png-renderer': packageConfigs('png-renderer', 'index', { external: ['@napi-rs/canvas'] }),

	// The control only uses maplibre-gl's types, so the bundle has no runtime dependency on
	// it. The UMD build is minified; the ES module is left readable for bundlers.
	'maplibre-svg-export': packageConfigs('maplibre-svg-export', 'maplibre-svg-export', {
		extraOutputs: [
			{
				file: 'packages/maplibre-svg-export/dist/maplibre-svg-export.umd.min.js',
				format: 'umd',
				name: 'VersaTilesSVG',
				sourcemap: true,
				plugins: [terser()],
			},
		],
	}),
};

const only = process.env.PACKAGE;
if (only !== undefined && !(only in packages)) {
	throw new Error(
		`Unknown PACKAGE "${only}", expected one of: ${Object.keys(packages).join(', ')}`,
	);
}

export default defineConfig(only === undefined ? Object.values(packages).flat() : packages[only]!);
