# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The style's `center` and `zoom` as the default view.** A view without `lon`, `lat` or `zoom` showed `0, 0` at zoom 2. As in MapLibre GL JS, the style's own `center` and `zoom` now fill in what the view does not set; `0, 0` and zoom 2 remain the fallback for styles without them. This applies to rendering and to `project`/`unproject`. ([#56](https://github.com/versatiles-org/versatiles-svg-renderer/issues/56))
- **Tile source options: `scheme`, `minzoom`, `bounds` and several tile URLs.** Vector and raster sources used only their first tile URL and `maxzoom`. Tiles are now requested as in MapLibre GL JS: spread over all URLs in `tiles` (by the tile's position), with y counted from the south for `scheme: "tms"`, and not at all below `minzoom` or outside `bounds`. These values may also come from a TileJSON document. ([#51](https://github.com/versatiles-org/versatiles-svg-renderer/issues/51))
- **GeoJSON data from a URL.** A GeoJSON source whose `data` is a URL drew nothing. The renderer now loads it with the `fetch` option, once per `SVGMapRenderer` or `PNGMapRenderer`, like a TileJSON document; data that cannot be loaded is reported through `onWarning`, and the next render tries again. ([#52](https://github.com/versatiles-org/versatiles-svg-renderer/issues/52))
- **Warnings about what is not drawn.** Parts of a style the renderer does not draw were skipped silently. They are now reported through the new `onWarning` option (`(message: string) => void`, default `console.warn`), once per renderer: unsupported layer types (`fill-extrusion`, `heatmap`, `hillshade`, `color-relief`), unsupported layer properties (e.g. `fill-pattern`, `symbol-placement: "line"`), unsupported sources (`raster-dem`, `image`, `video`), TileJSON documents and GeoJSON data that could not be loaded, and `terrain`. Properties without an effect on a flat, north-up map are not reported, nor are symbol layers unless `renderLabels` is set. The SVG export control lists the warnings below its preview, and also warns when the map is rotated or tilted, since the SVG is always north-up and flat. ([#58](https://github.com/versatiles-org/versatiles-svg-renderer/issues/58))
- **TileJSON sources.** A source that points at a TileJSON document (`"url": "…/tiles.json"`) instead of listing `tiles` rendered as an empty map without an error. The renderer now fetches the document (with the `fetch` option, once per `SVGMapRenderer` or `PNGMapRenderer`) and takes `tiles`, `minzoom`, `maxzoom` and the like from it; values set in the style win, as in MapLibre GL JS. Relative tile URLs are resolved against the document's URL. A document that cannot be loaded leaves its source empty, and the next render tries again. ([#50](https://github.com/versatiles-org/versatiles-svg-renderer/issues/50))

### Fixed

- **Features of different sources no longer mix when their layer names match.** A style with two vector sources that both have a layer `water` drew the `water` features of both sources in each style layer, and a GeoJSON source named like a vector layer (e.g. `water`) added its features to that layer. Features are now kept per source. A GeoJSON style layer also ignores `source-layer` now, as in MapLibre. ([#36](https://github.com/versatiles-org/versatiles-svg-renderer/issues/36))

## [2.1.0] - 2026-09-22

### Added

- **`SVGMapRenderer` and `PNGMapRenderer`: render many views of one style.** Create one with the style (and `renderLabels`), then call `renderSVG(view)` or `renderPNG(view)` for each view. The style is parsed once, the sprite is fetched once, and fetched tiles are kept up to `tileCacheSize` (default 128 MB, least recently used dropped first), so overlapping views do not fetch them again. `PNGMapRenderer` also keeps decoded images, and renders SVG too, from the same tiles. `clearCache()` forgets what was fetched. Exported by all three packages (`PNGMapRenderer` by `@versatiles/png-renderer` only).
- **`fetch` option: load tiles and sprites your own way.** `SVGMapRenderer`, `PNGMapRenderer`, `renderToSVG` and `renderToPNG` take a `fetch` function, `(url: string) => Promise<Response>`, used instead of the global `fetch`: to send headers, go through a proxy, or cache tiles on disk (an example is [`examples/cached-fetch.ts`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/png-renderer/examples/cached-fetch.ts) of `@versatiles/png-renderer`). The types are exported as `FetchFunction` and `FetchResponse` (the part of a `Response` the renderer reads), so they need neither the DOM nor Node's type definitions.
- **`renderCanvas` and `renderToCanvas` (`@versatiles/png-renderer`): the rendered canvas**, instead of a PNG file, to draw on it or to encode it in another format (`canvas.encode('webp' | 'jpeg' | 'avif')`). Its context is left in its default state apart from the pixel-density scale, also on the globe.
- **`project(view, [lon, lat])` and `unproject(view, [x, y])`** on `SVGMapRenderer` and `PNGMapRenderer`: where a coordinate lands in the image of a view, in the units of `width` and `height`, to place your own drawing on an SVG or a canvas. `undefined` for a point on the far side of the globe. `unproject(view, [x, y])` is the opposite: the coordinate shown at a position in the image, or `undefined` where the image shows no map.
- The tile cache remembers tiles the server does not have (HTTP 404 and 204); failed requests (network errors, other error statuses) are not kept, so the next render tries again.

### Changed

- `renderToSVG` and `renderToPNG` render through the new classes. Their options and output are unchanged; within a single render, a tile that appears twice (e.g. in a wide view at a low zoom) is now fetched once.
- **TypeScript users of `@versatiles/png-renderer` need `@types/node`** (or `skipLibCheck`): the `Canvas` that `renderCanvas` returns is typed by `@napi-rs/canvas`, whose types use Node's. For the same reason, a new major version of `@napi-rs/canvas` will be a breaking change of this package.

## [2.0.0] - 2026-09-21

**2.0.0 splits the package into three**, one per use case, released together under the same version number:

| Package                           | For                                               | Runs in           |
| --------------------------------- | ------------------------------------------------- | ----------------- |
| `@versatiles/svg-renderer`        | `renderToSVG`                                     | Node.js, browsers |
| `@versatiles/png-renderer`        | `renderToPNG`, plus `renderToSVG`                 | Node.js           |
| `@versatiles/maplibre-svg-export` | the MapLibre GL JS control `SVGExportControl`     | browsers          |

### Migrating from 1.x

| 1.x                                                                       | 2.0                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `import { renderToSVG } from '@versatiles/svg-renderer'`                  | unchanged                                                                                                       |
| `require('@versatiles/svg-renderer')`                                     | ESM only. Use `import`; Node.js 22.12 or later can also `require()` it                                          |
| `import { SVGExportControl } from '@versatiles/svg-renderer/maplibre'`    | `import { SVGExportControl } from '@versatiles/maplibre-svg-export'`                                            |
| `<script src="https://unpkg.com/@versatiles/svg-renderer/dist/maplibre-svg-export.umd.js">` | `<script src="https://cdn.jsdelivr.net/npm/@versatiles/maplibre-svg-export@2">`; the `VersaTilesSVG` global is unchanged |
| `maplibre-gl` as a peer dependency                                        | not needed: the plugin brings its own types and never imports maplibre-gl                                        |

`SVGExportControl` and `renderToSVG` take the same options as in 1.2.0.

### Added

- **`@versatiles/png-renderer`: PNG output in Node.js.** `renderToPNG` takes the options of `renderToSVG` plus `scale` (pixel density) and `fonts` (font files for labels, by the style's `text-font` names). It draws with Skia through `@napi-rs/canvas`, which is installed with the package, including the binary for the platform; there is no install script. WebP raster tiles, line blur and raster colour adjustments are supported. It also exports `renderToSVG`.
- **A clear error when the canvas binary is missing.** It names the platform (e.g. `linux-arm64-musl`) and the missing `@napi-rs/canvas-<platform>` package, and explains the usual causes: installing with `--omit=optional`, or copying `node_modules` from another OS or CPU architecture into, say, a Docker image. `renderToSVG` keeps working without the binary.
- **`@versatiles/maplibre-svg-export` as its own package**, with a minified UMD bundle (173 KB, 46 KB gzipped; 391 KB unminified in 1.2.0). jsDelivr serves it as the package's default file, and every GitHub release has a `maplibre-svg-export.tar.gz` with the bundles, types, README and license for self-hosting.

### Changed

- **ESM only.** The CommonJS builds (`index.cjs`) are gone. Node.js 22.12 or later can `require()` the ES modules.
- **The MapLibre plugin moved** from `@versatiles/svg-renderer/maplibre` to `@versatiles/maplibre-svg-export`, and its UMD file is now `dist/maplibre-svg-export.umd.min.js`.
- **No `maplibre-gl` peer dependency.** The plugin declares the few MapLibre types it needs itself, so its `.d.ts` has no imports; a type test keeps those declarations in line with MapLibre GL JS.
- `@versatiles/svg-renderer` has a single entry point with `renderToSVG`, and no optional peer dependencies.

### Internal

- The repository is an npm workspace: the renderer lives in the private `packages/core` and is bundled into each package; `packages/svg-renderer`, `packages/png-renderer` and `packages/maplibre-svg-export` hold the entry points.
- **New release process:** pushing a `v*` tag runs a GitHub workflow that builds, tests and packs all packages, publishes them to npm with provenance through trusted publishing (no npm token), and creates the GitHub release with the plugin tarball. It replaces `vrt release-npm`.
- `npm run test:pack` packs every package and installs each into its own clean project, checking file lists, runtime, types (`skipLibCheck` off) and the release tarball. With `--docker`, it also installs png-renderer on Linux with glibc (Node.js 22) and musl (Node.js 24).
- `npm run docs` regenerates the README graphics, replacing the `prepack` hook; the dev server also rebuilds on changes to the plugin's own sources.
- The browser test of the MapLibre control now runs against MapLibre GL JS 5 (with the ES module build) and MapLibre GL JS 6 (with the minified UMD build, as versatiles-frontend uses it), and checks that the map's interactions are disabled while the export panel is open and restored afterwards.

## [1.2.0] - 2026-09-19

### Changed

- **Renamed the MapLibre plugin bundle** from `maplibre.*` to `maplibre-svg-export.*`, so the distributed files no longer collide with MapLibre GL JS's own `maplibre-gl.js`. The `@versatiles/svg-renderer/maplibre` import subpath and the `VersaTilesSVG` UMD global are unchanged — only the physical file names and CDN paths changed (e.g. `dist/maplibre-svg-export.umd.js`). ([7886d99](https://github.com/versatiles-org/versatiles-svg-renderer/commit/7886d9978122b1f63ca772b770cc42c784e2a66a))
- Excluded source-map (`*.map`) files from the published npm package, shrinking the tarball's unpacked size from ~4.5 MB to ~1.3 MB. Maps are still generated in `dist/` for local debugging. ([89da461](https://github.com/versatiles-org/versatiles-svg-renderer/commit/89da46164662c4ab4e4990689af7ee212e0a6b59))
- **The MapLibre export control now defaults to the current map viewport size.** The Width/Height inputs previously opened at a fixed 1024×1024, so an export rarely matched the size or aspect ratio of the map on screen. They are now seeded from the live viewport each time the panel opens, so the default export matches what the user sees. Pass `defaultWidth`/`defaultHeight` to `SVGExportControl` to keep a fixed size. ([333adea](https://github.com/versatiles-org/versatiles-svg-renderer/commit/333adea137ce0e4b0776b80cf5f74bfa19993d88))

### Removed

- Dropped the CommonJS build of the MapLibre plugin (`maplibre-svg-export.cjs`). The browser-only control now ships as ESM + UMD only; nothing consumes a MapLibre control through CommonJS `require()`. The core `renderToSVG` entry keeps its CommonJS build. ([5003d32](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5003d329872455ed47576324c4ea9a6f80b626b3))
- Removed the unused `mergePolygonsByFeatureId` helper (`src/sources/merge.ts`) and the `@turf/union` dev dependency it required. The function was never wired into the render pipeline; dropping it also prunes `@turf/union`, `polyclip-ts`, and their transitive packages from the dependency tree. ([1cba1af](https://github.com/versatiles-org/versatiles-svg-renderer/commit/1cba1afd56880dffaf0e8cbd794b0c044906c89d))

> **Note:** the bundle rename and the removed plugin CommonJS build are breaking for anyone importing those files by their old physical path or via `require('@versatiles/svg-renderer/maplibre')`. Importing from the `@versatiles/svg-renderer/maplibre` ESM subpath, or loading `VersaTilesSVG` from the CDN UMD, keeps working.

### Fixed

- **Raster tiles and sprite sheets no longer crash the renderer in the browser.** Base64 encoding spread an entire tile/sprite byte array into a single `String.fromCharCode(...)` call, which overflows the JS engine's argument-count limit and throws `RangeError: Maximum call stack size exceeded` for any image above ~64 KB (Node was unaffected). Encoding now uses the native `Uint8Array.prototype.toBase64()` when available and a chunked fallback otherwise. ([a9c0b97](https://github.com/versatiles-org/versatiles-svg-renderer/commit/a9c0b9723d8a698100540e970951b5ad95ec8870), [0de690f](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0de690fb5fa7e827361a8ee5a9c5f3f7a6d7ace4))
- **Attribution links in the export panel are preserved again.** The HTML sanitizer built an allow-listed DOM (safe tags, plus `https` links hardened with `target`/`rel="noopener noreferrer"`) but then returned only its text content, silently stripping every tag and link. It now serializes the sanitized tree back to HTML, so allowed formatting and links survive while `<script>` and `javascript:` URLs are still removed. ([ac23f19](https://github.com/versatiles-org/versatiles-svg-renderer/commit/ac23f19a9a88ddaeac7779d5763e57cb22a06052))

### Internal

- Added a `typecheck` step to CI so type regressions fail the build (previously only lint/build/test ran). ([1ae2269](https://github.com/versatiles-org/versatiles-svg-renderer/commit/1ae2269b305bfa02f6899ae82f1bae9175179744))

### Features

- add dependency graph SVG and configuration for VRT ([276d450](https://github.com/versatiles-org/versatiles-svg-renderer/commit/276d450f8f096cb5ea828ab5adedf697cf0e932a))
- implement globe projection and geometry handling ([916e1d1](https://github.com/versatiles-org/versatiles-svg-renderer/commit/916e1d163b846e6c25d0e4282e9eb9482af71ff5))

### Bug Fixes

- update upgrade script to use vrt deps-upgrade ([e346fa0](https://github.com/versatiles-org/versatiles-svg-renderer/commit/e346fa08cd07e0b4af10e403c2f02be8e4a2c9fb))
- update vector values in diff-baseline.json for accuracy ([fe8b913](https://github.com/versatiles-org/versatiles-svg-renderer/commit/fe8b913f40b17cb57b97a1d5cda03cee9dc147ac))
- update vector values in diff-baseline.json for accuracy and adjust pixelmatch threshold for vector maps ([7a86a97](https://github.com/versatiles-org/versatiles-svg-renderer/commit/7a86a97557f7a0a3a3d7268ef534dd4a7325163c))
- update vector values in diff-baseline.json for accuracy and adjust zoom level for world region in styles.ts ([e7c5158](https://github.com/versatiles-org/versatiles-svg-renderer/commit/e7c51588606560773804175871347cb84c366c3b))
- update vector values in diff-baseline.json for accuracy and enhance globe shader precision in styles.ts and maplibre-page.ts ([9863c79](https://github.com/versatiles-org/versatiles-svg-renderer/commit/9863c7980c34e589cd52aacd94e82ded18aacb09))
- enhance typecheck script to include additional TypeScript configurations for e2e and dev ([c3e1f0f](https://github.com/versatiles-org/versatiles-svg-renderer/commit/c3e1f0f7614b68af14dbb178253138d5dd9fda13))
- remove scale parameter from SVGRenderer instantiation in makeJob function ([5a3358b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5a3358b6f2e0a42fbd15aba35155f764e9e8952a))
- update vector values in diff-baseline.json for accuracy; add polygon clipping functions and tests for rendering ([45a4da4](https://github.com/versatiles-org/versatiles-svg-renderer/commit/45a4da49f868d56ffec6c89d4659e4f5f2738786))
- update vector values in diff-baseline.json for accuracy; enhance SVGRenderer to handle translucent lines and add line clipping functionality ([843c011](https://github.com/versatiles-org/versatiles-svg-renderer/commit/843c011ebc8aaab2d559b044718ab5c7fd4996e7))

### Code Refactoring

- update style handling to use inlineSources for MapLibre styles ([3196239](https://github.com/versatiles-org/versatiles-svg-renderer/commit/3196239a36e4992b9548afa5315189c337182cb3))
- update raster handling to use triangles instead of cells for globe projection ([215f51c](https://github.com/versatiles-org/versatiles-svg-renderer/commit/215f51c6d8c34f1e2ad8393316acc586c8483178))

### Chores

- add security update groups for GitHub Actions and npm in dependabot configuration ([ca8eac4](https://github.com/versatiles-org/versatiles-svg-renderer/commit/ca8eac4173a704d726b13b1cdf4fdf0d1b3319be))
- update dependencies in package.json ([ca464de](https://github.com/versatiles-org/versatiles-svg-renderer/commit/ca464de42acbf9bc605cf2a9a96b1ddb6d1d9282))

## [1.1.0] - 2026-08-15

### Features

- implement installMapLibrePage function for serving MapLibre assets ([753acec](https://github.com/versatiles-org/versatiles-svg-renderer/commit/753acec20b0d828af8994ec4a58667e07ce7e5d3))
- add retry mechanism for rendering screenshots and log crashes ([0f308da](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0f308dad9af7023a0d49c07b3087cab83a5d7794))
- add dynamic Playwright image resolution in GitHub Actions workflow ([181ce82](https://github.com/versatiles-org/versatiles-svg-renderer/commit/181ce82bf3ae3ff105717206d6d322d888c16b1d))

### Documentation

- update README to format required style option as italic ([7eb96cf](https://github.com/versatiles-org/versatiles-svg-renderer/commit/7eb96cf4af13b024279de3985d5100591a8aee98))

### Chores

- **deps:** bump actions/setup-node from 6 to 7 in the action group ([40549e3](https://github.com/versatiles-org/versatiles-svg-renderer/commit/40549e319ed3d6f018620f4b89e16702b69342d6))
- update dependencies in package.json ([e9d7a3b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/e9d7a3be674b3f57fb1a77187059215532e70018))
- add tslib as a dependency in package.json and package-lock.json ([128bf33](https://github.com/versatiles-org/versatiles-svg-renderer/commit/128bf339ae979f39ebaa8ff8353ae59ce75531f2))

## [1.0.0] - 2026-07-16

### Features

- update references to maplibre-svg-export for consistency across files ([7886d99](https://github.com/versatiles-org/versatiles-svg-renderer/commit/7886d9978122b1f63ca772b770cc42c784e2a66a))
- implement arrayBufferToBase64 function for encoding ArrayBuffers to Base64 ([a9c0b97](https://github.com/versatiles-org/versatiles-svg-renderer/commit/a9c0b9723d8a698100540e970951b5ad95ec8870))
- enhance HTML sanitization to preserve allowed tags and safe links ([ac23f19](https://github.com/versatiles-org/versatiles-svg-renderer/commit/ac23f19a9a88ddaeac7779d5763e57cb22a06052))
- add default export size options to SVGExportControl ([333adea](https://github.com/versatiles-org/versatiles-svg-renderer/commit/333adea137ce0e4b0776b80cf5f74bfa19993d88))

### Bug Fixes

- remove CommonJS output for maplibre-svg-export as it is not required ([5003d32](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5003d329872455ed47576324c4ea9a6f80b626b3))
- exclude source map files from package distribution ([89da461](https://github.com/versatiles-org/versatiles-svg-renderer/commit/89da46164662c4ab4e4990689af7ee212e0a6b59))

### Code Refactoring

- replace base64 encoding logic with arrayBufferToBase64 utility in raster and sprite sources ([0de690f](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0de690fb5fa7e827361a8ee5a9c5f3f7a6d7ace4))
- remove Turf.js dependencies and related merge functionality ([1cba1af](https://github.com/versatiles-org/versatiles-svg-renderer/commit/1cba1afd56880dffaf0e8cbd794b0c044906c89d))

### Documentation

- enhance SVGExportControl documentation with bundler import example ([2b9b736](https://github.com/versatiles-org/versatiles-svg-renderer/commit/2b9b7365fa4266be3ac32045acf3a3c14d6be803))
- update changelog with recent changes to MapLibre plugin bundle and package structure ([84b1ea3](https://github.com/versatiles-org/versatiles-svg-renderer/commit/84b1ea34fbb1ab4c4a2db1f25c8316d5dd9aa8ff))

### CI/CD

- add typecheck step to CI workflow ([1ae2269](https://github.com/versatiles-org/versatiles-svg-renderer/commit/1ae2269b305bfa02f6899ae82f1bae9175179744))

### Chores

- update changelog with recent changes and fixes ([8f588eb](https://github.com/versatiles-org/versatiles-svg-renderer/commit/8f588eb34a4e0494b7d0af2bbc6dfe468572a030))

## [0.8.0] - 2026-07-16

### Features

- implement line-offset and add line-blur support ([d872106](https://github.com/versatiles-org/versatiles-svg-renderer/commit/d8721062f3f3358ce332363c0418ca1f1f768117))
- add regression testing for SVG rendering with baseline comparison ([18ed351](https://github.com/versatiles-org/versatiles-svg-renderer/commit/18ed35134e12ae249dcf1742c2a41d010789b836))
- add geojson stack source for cascading, overlapping squares with correct paint order ([722a060](https://github.com/versatiles-org/versatiles-svg-renderer/commit/722a060138bc0dbf5d4f1c665c9c35d8998281d7))
- implement fill-antialiasing with outline color support in SVGRenderer ([fb62ed8](https://github.com/versatiles-org/versatiles-svg-renderer/commit/fb62ed871516d86b4d842ac1ca50bbf05dc3b7e1))
- add polygon outlines for accurate line rendering and prevent duplicate fills ([4fed4f3](https://github.com/versatiles-org/versatiles-svg-renderer/commit/4fed4f3feaad721a1bf4bdd54d0c9f662721c9b0))

### Bug Fixes

- remove unnecessary type assertions in various files ([5deef56](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5deef56f23c99f3635d158abfba98ae073ccaa85))
- update funding information in FUNDING.yml ([ef4211d](https://github.com/versatiles-org/versatiles-svg-renderer/commit/ef4211d17af4135284a3ff7dc31d53111851792e))
- update Pbf import to use PbfReader class ([25e847b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/25e847b4d241928be50ee92a5e396fed98ef269f))
- enhance filter function and normalize property expressions in StyleLayer ([67788c0](https://github.com/versatiles-org/versatiles-svg-renderer/commit/67788c01ca8b6c48cb8d10ba5d898fb9d017998f))
- implement snapping of polygon coordinates to improve union stability ([11e6fb3](https://github.com/versatiles-org/versatiles-svg-renderer/commit/11e6fb36ee9eebd96c79e9b75b4f28384b7205cd))
- implement incremental union of polygon features to handle floating-point robustness issues ([3c24943](https://github.com/versatiles-org/versatiles-svg-renderer/commit/3c24943a3c9e096fb13823fc37554187ead8fbf4))
- update package overrides and allowScripts ([802ffd5](https://github.com/versatiles-org/versatiles-svg-renderer/commit/802ffd5cd6cf12578228f99791756d826c061cd3))
- downgrade undici to version 7.28.0 and update node engine requirement ([d7a6340](https://github.com/versatiles-org/versatiles-svg-renderer/commit/d7a6340cf7408ef51f3df1866ee989325030ac10))
- include URL in cached response when writing to cache ([5a51b3f](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5a51b3f2c902d3f0a878ec1de888a0a15a87a90b))
- cache only successful, non-empty responses in cachedFetch ([95729d6](https://github.com/versatiles-org/versatiles-svg-renderer/commit/95729d69d809a91f1a8f13e5d5c2389bfde11c8a))
- cache only successful, non-empty responses in installPageCache function ([e65e3b6](https://github.com/versatiles-org/versatiles-svg-renderer/commit/e65e3b6884bcafbfa9c43e68ac6c6b4799df2694))
- update route pattern in installPageCache to match all URLs ([b1785c4](https://github.com/versatiles-org/versatiles-svg-renderer/commit/b1785c4d501a90db62ef157ca1f867f483e2fccb))
- implement retry logic for caching in installPageCache and cachedFetch functions ([363f297](https://github.com/versatiles-org/versatiles-svg-renderer/commit/363f297fff7a6cb39f3f10fc8a39dfe93124aac7))
- adjust Gaussian blur implementation for line rendering and improve opacity calculation ([699f55e](https://github.com/versatiles-org/versatiles-svg-renderer/commit/699f55e62d0b309740a962f616b79fb35c181b35))
- include LineString features in fill layer rendering for parity with polygons ([33f6867](https://github.com/versatiles-org/versatiles-svg-renderer/commit/33f6867cb75ea150ae7e6520158883dd71051acb))
- refactor SVG rendering logic for improved Gaussian blur and opacity handling ([5e0a3fb](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5e0a3fb38b5d03a7c8a70c872f23c857bb5ac4b9))
- update pages assembly to include new demo and distribution directories ([ec72994](https://github.com/versatiles-org/versatiles-svg-renderer/commit/ec72994696af5f905a1eb4f985d4af12bcc63b4c))
- remove package.json from prettier ignore list ([62ce372](https://github.com/versatiles-org/versatiles-svg-renderer/commit/62ce3729ab335ad5491a906933edc1b507e45d7a))
- merge consecutive features with identical attributes for correct paint order ([884762b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/884762bc46043f1e01528b7281585fa3e7bf417e))
- update baseline values and improve screenshot rendering for accurate pixel comparison ([fbacfdf](https://github.com/versatiles-org/versatiles-svg-renderer/commit/fbacfdf245c7e803afdf03e9c87f00a00dc8864b))
- adjust berlin-geojson baseline value and update geojson region coordinates for accurate rendering test: add case to verify radius adjustment for stroke width in circle rendering refactor: modify SVGRenderer to correctly account for stroke width in drawn radius ([a8efcb7](https://github.com/versatiles-org/versatiles-svg-renderer/commit/a8efcb7a46c1300f07cd0e794e5bddd1756b7658))
- update berlin-geojson baseline value for accurate rendering and enhance geojson stack source with rainbow color features ([1157b8e](https://github.com/versatiles-org/versatiles-svg-renderer/commit/1157b8e3097b4acd763cd0d2acb8475857902418))
- add explicit choropleth-style border to geojson fill for correct rendering ([5efe338](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5efe3388aa73ea0f0bdcc9ebae92916a67649ffe))
- update berlin-geojson baseline value and adjust tolerance thresholds for rendering accuracy ([f591221](https://github.com/versatiles-org/versatiles-svg-renderer/commit/f59122124de53923ceba98e9c6c8d20c8f741643))

### Code Refactoring

- remove polygon merging logic from getLayerFeatures function ([5982aef](https://github.com/versatiles-org/versatiles-svg-renderer/commit/5982aef95fe87d86979aefe888c0f2da8a560589))
- add parallel processing for screenshots ([a73fe6c](https://github.com/versatiles-org/versatiles-svg-renderer/commit/a73fe6c7e819ecbcb454c95d659337a44af69ae2))

### Documentation

- add README for end-to-end tests and entry points ([0fb1647](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0fb1647222aee1e950d3f0ba80d3ae513cf3a540))

### Tests

- add regression test for merging polygons that trigger polyclip-ts bug ([588b4d3](https://github.com/versatiles-org/versatiles-svg-renderer/commit/588b4d3d7f61b8962de4d3e92afac1a5ea7fa3e2))
- add case for merging consecutive same-attribute features to preserve draw order ([0d2ad92](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0d2ad92ab55dcd74a02702273aa70d23f2382e56))

### CI/CD

- update Playwright container image to v1.61.1 ([e3ef49b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/e3ef49b3773effb13922eeac61c70b0672d0ae0b))

### Chores

- update dependencies to latest versions ([343b473](https://github.com/versatiles-org/versatiles-svg-renderer/commit/343b4731715e428ede119804e0ef731013d806d0))
- **deps:** bump actions/upload-pages-artifact in the action group ([dfff1bb](https://github.com/versatiles-org/versatiles-svg-renderer/commit/dfff1bb00414de9b825c240618793b4e19f5b670))
- **deps-dev:** bump the npm group with 3 updates ([9fb0856](https://github.com/versatiles-org/versatiles-svg-renderer/commit/9fb085648b53c9ad50e1f752663fb8330d20bd71))
- **deps-dev:** bump the npm group with 14 updates ([0d87b6d](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0d87b6d4d7a14249234522fe2e7450c744074057))
- **deps:** bump the action group with 2 updates ([0f6f13b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/0f6f13bbe6b8489b8a49a7b79779db067b4c0d1d))
- **deps-dev:** bump the npm group with 13 updates ([1c5db0b](https://github.com/versatiles-org/versatiles-svg-renderer/commit/1c5db0b8ead82162a1586ebb4956c7bd0065a5d4))
- **deps-dev:** update dependencies to latest versions ([b1158cf](https://github.com/versatiles-org/versatiles-svg-renderer/commit/b1158cfce5ac17497d86efefc15f2c0938fc9b96))

### Styles

- update format ([b5dedb9](https://github.com/versatiles-org/versatiles-svg-renderer/commit/b5dedb948cd2f393c8b9c950a35d92f25e6f44d7))

## [0.7.3] - 2026-04-04

### Bug Fixes

- **deps:** update devDependencies to latest versions
- simplify upgrade script in package.json
- **deps:** update jsdom and npm-check-updates to latest versions
- update Playwright container image to v1.59.1

### Chores

- **deps:** bump the action group with 2 updates

## [0.7.2] - 2026-03-12

### Bug Fixes

- update SVGRenderer to use xlink:href for <use> and <image> elements
- add id attribute to <g> element in SVG output
- update Node.js version to 24 in CI workflows

## [0.7.1] - 2026-03-12

### Features

- add dev script for render comparison
- enhance SVG rasterization by supporting multiple Playwright browsers
- enhance render comparison output with improved HTML structure and styling
- add Inkscape installation and enhance render comparison output in GitHub Pages workflow
- update render comparison HTML title and add description for experimental feature
- update render comparison link text to indicate experimental status
- set HOME environment variable for render comparison step

### Bug Fixes

- update HTML table structure for rendered images in test-icons
- refactor location handling and improve HTML output for icon rendering
- add TypeScript error suppression comments for deep type instantiation
- swap test and typecheck scripts in package.json
- simplify MapLibre GL JS map initialization options

### Code Refactoring

- rename render comparison script

### Documentation

- update README to include additional supported layer types and new renderLabels option

### CI/CD

- rename GitHub workflow

### Styles

- format code

## [0.7.0] - 2026-03-11

### Features

- enhance SVG rendering with sprite sheet and symbol definitions for improved icon handling
- add test-icons script for SVG rendering and rasterization
- add support for SDF filters in SVG rendering for colorable icons
- implement SDF icon rendering with color filters and halo effects

### Bug Fixes

- repair feature handling by splitting MultiPoint into individual Point features
- use retina sprites
- update check script to include typecheck step
- update tsconfig.json to exclude 'dev' directory from compilation
- handle undefined spritePair in loadSpriteAtlas function
- update format script to include log level warning for prettier

## [0.6.0] - 2026-03-10

### Features

- add drawSymbols method for rendering text with styles in SVG
- add support for rendering symbols with dynamic text in SVG
- add drawSymbols method and SymbolStyle interface for enhanced SVG rendering
- add option to include text labels in SVG rendering and update related UI components
- implement icon rendering support in SVG with sprite atlas integration
- update rendering methods to include layer IDs
- add support for rendering symbol layers with text and icons in SVG
- enhance SVG rendering tests with support for symbol and icon layers
- add tests for loadSpriteAtlas function to validate sprite loading and error handling
- enable hash support in map configuration for improved URL handling

### Bug Fixes

- add viewport meta tag for better mobile rendering
- update notice about text label rendering and collision detection in SVG export panel
- update default font family in SVG rendering to include Helvetica and Arial
- update label for checkbox to include icons in SVG export options

### Chores

- **deps-dev:** bump the npm group with 8 updates
- **deps:** bump actions/upload-artifact in the action group
- update sub dependencies

## [0.5.2] - 2026-02-18

### Code Refactoring

- remove scale parameter from SVG rendering components

## [0.5.1] - 2026-02-18

### Bug Fixes

- allow sanitized HTML as attribution
- add coverage reporters to Vitest configuration

### Tests

- SVGExportControl and rendering tests
- enhance renderMap tests with fill, line, and circle layer scenarios

## [0.5.0] - 2026-02-18

### Features

- add copyright notice to SVG export panel and style it
- enhance SVG export panel with attribution notice and styling
- update TypeScript configurations, enhance ESLint rules, and improve bundle analysis script

### Bug Fixes

- update .prettierignore to include README.md and ensure package.json is properly formatted

### Code Refactoring

- migrate RenderJob and related types to renderer_svg module, remove obsolete types.ts
- reorganize types and move segment-related functions to svg_path module
- move helper to processor/sources
- move processor/source one level up
- replace Point2D with tuple for center coordinates in rendering and testing modules
- replace Point2D with tuple for translate coordinates in renderer and types
- move style_layer module to processor directory and update imports
- move geometry module to sources directory and update imports
- update color handling to use MaplibreColor across renderer and styles
- implement Color class with various constructors and methods for color manipulation
- move d2h function outside of Color class for better accessibility
- extract getFeatures function for improved feature retrieval
- update loadGeoJSONSource to use GeoJSON type for improved type safety
- update loadVectorSource to use VectorSourceSpec for improved type safety
- replace magic numbers with VTFeatureType constants for improved readability
- simplify evaluate calls in StyleLayer for improved clarity
- enhance error logging in getTile function for improved debugging
- streamline parameter handling in renderToSVG for improved readability
- improve error messages in getRasterTiles and Color constructor
- improve tile wrapping logic in calculateTileGrid for better tile management
- optimize bbox calculation in Feature class for improved performance
- change values property to be mutable in Color class
- rename mergePolygons to mergePolygonsByFeatureId for clarity
- rename folder renderer to pipeline
- rename renderer_svg to svg
- move geometry
- move types
- rename to merge.ts
- rename styles to panel_css
- merge styles into style_layer
- rename renderVectorTiles to renderMap and update imports
- rename processor subgraph to pipeline and update related references
- move Features and LayerFeatures types to geometry.ts and update imports
- update TypeScript configurations and improve type safety across multiple files
- add sideEffects flag to package.json and simplify color tests
- update notice element to use textContent for safer HTML handling
- improve error handling in SVG preview by using textContent for safer DOM manipulation
- update polygon handling in loadGeoJSONSource for improved feature extraction
- enhance stroke attributes handling in SVGRenderer for improved styling options
- remove unused style properties from LineStyle and CircleStyle interfaces for cleaner code
- update loadGeoJSONSource calls to use options object for improved readability
- optimize loadVectorSource calls by using Promise.all for concurrent loading
- enhance type safety in getPaint and getLayout functions for improved code clarity
- replace roundValue with formatScaled for consistent scaling in SVG rendering
- add filterFn to StyleLayer for enhanced filtering capabilities
- improve code readability by formatting multi-line expressions in analyze-bundle.ts
- streamline SVG rendering by removing opacity parameter and enhancing style handling
- simplify SVG attributes by removing unnecessary decimal places in circle radius and stroke width

### Tests

- add unit tests for geojson, raster, and tile processing
- improve error handling in geojson and raster tests
- add unit tests for SVG rendering and vector source loading

## [0.4.0] - 2026-02-18

### Features

- implement drawCircles method and CircleStyle interface for SVGRenderer
- add geojson as source
- add end-to-end tests for geojson rendering with circle, fill, and line layers
- implement fetch caching mechanism for improved performance in tests
- implement caching for network requests in fetch-cache and enhance e2e tests
- add geojson support to regions and enhance style configuration
- refactor feature creation in loadGeoJSONSource for improved clarity and reusability
- optimize polygon merging by consolidating feature creation in mergePolygons
- enforce polygon winding order in makeFeature for consistent geometry processing
- add rgb and opacity getters to Color class for improved color handling
- enhance SVG background handling with dynamic color attributes
- enhance SVG output with clipPath and improved background rect dimensions
- update e2e workflow for GitHub Pages deployment and add demo HTML

### Bug Fixes

- update type assertion for coordinates in loadGeoJSONSource function
- update SVG screenshot file extension from .svg to .png
- lint warnings
- add script entry for maplibre in package.json exports
- comment out vulnerability check in CI workflow
- update CI workflow to omit dev dependencies in vulnerability check
- update .gitignore and package.json for documentation scripts
- format globalIgnores array in eslint configuration for better readability

### Code Refactoring

- source handling
- update CI and E2E workflows, move regions and run scripts
- update SVG rendering to use rect for background fill and simplify getString method

### Tests

- add end-to-end tests for rendering GeoJSON sources with circle, fill, and line layers
- improve geojson feature creation
- update coordinates for LineString in getStyle function

### Chores

- update devDependencies to latest versions
- update @versatiles/release-tool to version 2.7.2

## [0.3.0] - 2026-02-16

### Features

- add UMD build output for main and maplibre configurations in Rollup

### Bug Fixes

- update @versatiles/style dependency version to 5.9.4 in package.json and package-lock.json
- update MapLibre integration to use UMD build for SVGExportControl
- update UMD build output names for SVGExportControl in Rollup and README

## [0.2.0] - 2026-02-15

### Features

- add RasterStyle and RasterTile interfaces for enhanced rendering options
- enhance getTile function to return content type along with buffer
- implement getRasterTiles function for raster tile retrieval
- add drawRasterTiles method to SVGRenderer for rendering raster tiles
- add type property to regions and generate e2e results for satellite
- update satellite style to disable overlay in SVG rendering
- enhance getLayerFeatures to handle missing source and log errors for invalid configurations
- add drawRasterTiles tests for SVG rendering with various raster styles and filters
- add overlap to raster tile rendering to prevent sub-pixel gaps
- make screenshot images in report clickable for easier access
- add SVG export control for maplibre integration with customizable options
- add MapLibre control tests with SVG export functionality
- add Playwright browser installation and MapLibre E2E test steps to CI workflows
- add development server and initial HTML for SVG export control
- enhance SVG export preview styling for better responsiveness
- update SVG export controls to include Download and Open in Tab buttons
- add maxzoom parameter to calculateTileGrid and update raster source handling
- manage map interactions during SVG export
- update dependency graph to include MapLibre components
- refactor tile handling by moving calculateTileGrid and getTile functions to tiles.ts
- enhance README with detailed usage examples and additional options for renderToSVG
- update MapLibre integration example in README with HTML structure and script tags
- add badges for NPM version, downloads, code coverage, CI status, and license to README

### Bug Fixes

- handle Buffer availability for base64 encoding in getRasterTiles
- correct type checking for vector source in getLayerFeatures function
- update dependency graph structure and correct subgraph references in README
- include README.md in format script for prettier
- update dependencies in package-lock.json and remove unused packages
- update ESLint configuration to use array format for exports
- correct coverage configuration in vitest.config.ts to include and exclude specific files
- update format script in package.json to apply Prettier to all files
- remove unused StyleOptions, TextStyle, and SymbolStyle interfaces from types.ts
- update import paths in demo.ts for consistency
- ensure coverage includes all files in vitest.config.ts
- update actions/checkout and actions/setup-node to version 6
- refactor eslint configuration to use defineConfig and update ignores
- update license from Unlicense to MIT
- update README to format required option for SVGExportControl
- update README to format required option for SVGExportControl
- update license from Unlicense to MIT in package-lock.json

### Code Refactoring

- move style value retrieval functions inside render function for better encapsulation
- move getTile function
- reorganize tile-related interfaces and functions for improved structure
- reorganize dependency graph in README for clarity
- simplify tile array initialization and format drawRasterTiles call

### Chores

- **deps:** bump the action group with 2 updates

### Styles

- format function parameters and imports for improved readability
- improve formatting of style switch cases in getStyle function
- format files

## [0.1.0] - 2026-02-13

### Features

- add @versatiles/style dependency and demo implementation
- add maplibre-gl-js submodule
- add update-maplibre script to package.json for easier submodule updates
- enhance StyleLayer with visibility expression handling and global state references
- update package configuration and add Rollup build setup
- implement renderToSVG function for SVG rendering

### Bug Fixes

- line style
- layer opacity
- background color
- set filename
- reduce image size
- missing id
- update ESLint rules
- some minor eslint errors
- restore compilerOptions in tsconfig.node.json
- add 'ignore = dirty' to maplibre-gl-js submodule configuration
- add git reset to update-maplibre script for consistent state before fetching tags
- update subproject commit for maplibre-gl-js to latest version
- improve error handling for unimplemented layer styles in render function
- ensure tests pass even when no tests are present in the configuration
- add 'declare' to class field declarations to prevent parent assignments from being overwritten
- update @types/node to version 24.10.13 and refactor renderVectorTiles to return SVG string
- remove container from RenderJob and update vector tile fetching logic
- reorganize dependencies in package.json and add missing devDependencies
- improve error handling for unsupported Color arguments
- add checks to skip drawing for transparent polygons and lines
- update tile size calculation to use standard 512px tile size
- update ESLint ignore patterns and source file globbing
- simplify argument handling and type assertions in Color and StyleLayer classes
- include e2e directory in format script for prettier
- update region coordinates and zoom levels for accuracy
- format code for readability and consistency in screenshot generation
- correct zoom level for roma region in regions data
- include SVG size in comparison results and report
- reorder columns in E2E visual comparison report for clarity
- save SVG files for each region and update report to reference them
- add permissions for pages and id-token in E2E workflow
- add doc-graph script to automate dependency graph insertion in README
- update prepack script to include doc-graph generation before build
- update package name and description in package.json
- add missing metadata fields in package.json
- update bundle-stats.html path in rollup configuration
- correct homepage and bugs URLs in package.json
- update E2E workflow to include conditional execution and remove schedule
- enhance CI and E2E workflows with improved step naming and structure
- update README to reflect correct project name and improve clarity

### Code Refactoring

- remove unused console
- event handling and utility functions
- simplify ESLint configuration by consolidating imports and restructuring export
- cleanup types
- simplify type assertions in render function for clarity
- replace magic numbers with Infinity for bbox calculations
- replace magic number with TILE_EXTENT for scaling in getLayerFeatures
- remove console log for missing layer style implementations
- remove commented-out drawText and drawSymbol methods from SVGRenderer
- update .gitignore to include coverage and .DS_Store entries
- update import paths to use .js extensions
- Remove deprecated line and symbol style layer properties and related validation logic
- update zoom level and change SVG output path
- clean up code formatting and improve readability across multiple files
- optimize polygon and line string rendering by grouping paths
- update drawLineStrings to use segments and optimize path generation
- extract segment chaining logic into chainSegments function
- enhance segment chaining logic with normalization phases
- update segment handling in SVGRenderer for improved path generation
- add early returns in drawPolygons and drawLineStrings for empty features and zero opacity
- update SVGRenderer to use segments for path generation and improve point formatting
- replace instance methods with utility functions for point formatting and rounding in SVGRenderer
- remove unnecessary newline in SVGRenderer class
- remove abstract Renderer class and update SVGRenderer implementation

### Documentation

- add readme
- update readme
- smaller view
- add download link
- add line breaks
- update demo.svg
- add E2E visual comparison section with report link to README

### Tests

- add unit tests for Color, Point2D, Feature, and SVGRenderer classes

### Build System

- upgrade dependencies

### CI/CD

- add ci

### Chores

- update dependabot schedule to weekly and adjust versioning strategy
- update dependencies and devDependencies in package.json
- update dependabot configuration to use monthly schedule for npm and GitHub Actions
- update dependencies and devDependencies to latest versions
- update .gitignore and add sync-maplibre script to package.json
- update testing framework to Vitest and add configuration
- upgrade maplibre-gl-style-spec
- remove dependency on @versatiles/container version 1.2.7 from package.json
- clean up package.json and package-lock.json by removing unused dependencies fix: correct casing for 'node' in tsconfig.json types array
- update dependencies in package.json and package-lock.json to latest versions
- add Prettier configuration and update package dependencies
- remove unused file
- add permissions section to CI workflow
- add @vitest/coverage-v8 dependency to package.json
- update package-lock.json with new dependencies and versions
- update @types/node dependency to version 25.2.3
- update GitHub Actions to use latest versions of checkout and setup-node
- reorganize dependencies and remove external references in rollup config
- update rollup configuration and package dependencies
- add source-map-explorer for build analysis and update tsconfig for source maps
- replace source-map-explorer with custom bundle analysis script
- add end-to-end testing scripts and update dependencies for visual comparison
- add E2E visual comparison workflow with scheduled execution

### Styles

- format code

### Other Changes

- initial commit
- stuff
- switch to maplibre spec
- process vector tiles
- stuff
- stuff
- stuff
- stuff
- it basically works
- finally!
- cleanup
- Create LICENSE
- implement polygon merge
- add canvas
- add funding.yml
- minor fixes
- Add demo script to package.json and fix upgrade script formatting
