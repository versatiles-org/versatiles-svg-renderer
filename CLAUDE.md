# versatiles-svg-renderer

Renders MapLibre styles without a browser or WebGL: as SVG in Node.js and browsers, as PNG in Node.js, and as an "export as SVG" control for MapLibre GL JS. MapLibre GL JS is the reference for correct output.

## Packages

npm workspace, ESM only except for the plugin's UMD build. All packages share one version.

- `packages/core`: `@versatiles/renderer-core`. Private, never published, bundled into each package below. Published packages import only what `src/index.ts` exports.
- `packages/svg-renderer`: `@versatiles/svg-renderer`. Node.js and browsers. No native code, and its only dependency is `@types/geojson`.
- `packages/png-renderer`: `@versatiles/png-renderer`. Node.js only. Depends on `@napi-rs/canvas`, which it imports lazily and keeps external to the bundle.
- `packages/maplibre-svg-export`: `@versatiles/maplibre-svg-export`. ES module plus a minified UMD build with the global `VersaTilesSVG`. `versatiles-frontend` takes the UMD file from npm, so renaming it breaks that repo.

## Commands

- `npm run build`: build every package. `PACKAGE` selects one: `npx rollup -c rollup.config.ts --configPlugin @rollup/plugin-typescript --environment PACKAGE:maplibre-svg-export`.
- `npm test`: unit tests (`packages/`, `scripts/`, `bench/`). `npm run test:coverage` adds coverage.
- `npm run typecheck`: checks the root, `e2e`, `dev` and `bench` projects, which have separate tsconfigs.
- `npm run lint`, and `npm run format`, which rewrites files.
- `npm run test:pack`: installs each packed package in a clean project and uses it. Run `npm run build` first, since it packs the current `dist/`. `-- --docker` adds png-renderer on Linux with glibc and musl.
- `npm run test:e2e`: e2e Vitest files, then `test:e2e:maplibre` (plugin in a real browser), then `test:e2e:screenshots`.
- `npm run test:e2e:docker`: the screenshots in CI's Playwright container. `-- npm run test:e2e` runs any other command there instead.
- `npm run test:e2e:bless`: re-bless the baseline in that container.
- `npm run check`: format, lint, typecheck, build, unit, pack and e2e tests. Slow.
- `npm run dev`: plugin dev server at `http://localhost:3000/`, rebuilding on change.
- `npm run dev:render-comparison`: label and icon comparison for the Pages site. Needs Inkscape.
- `npm run demo`: regenerates the demo graphic.
- `npm run docs`: build, then regenerate the graphs and generated README sections. Commit the result.
- `npm run doc:typescript`: API docs into the gitignored `doc-typescript/`.
- `npm run bench`, `npm run profile`: see the README. `npm run bench` overwrites the tracked `docs/benchmark.svg`, so revert it unless the chart should change.
- `npx tsx scripts/generate-glyph-widths.ts`: regenerates `glyph_widths.ts`. Run it after updating `@fontsource/noto-sans`, and don't edit that file by hand.

Select screenshot regions by ID with `E2E_REGIONS=parity-features,berlin-vector`. This works on the host and in Docker. With `UPDATE_BASELINE=1`, such a run re-blesses only those regions.

## Testing rule

Every feature or fix gets tests.

If the claim is "behaves like MapLibre GL JS", unit tests aren't enough. Also add it to the e2e screenshot comparison, and report the measured diff numbers:

1. Plan the e2e case up front. Add a cell to a scene in `e2e/visual/scenes/`, or add a new scene with its own region in `e2e/visual/regions.ts`.
2. Run it with `E2E_REGIONS=<id> npm run test:e2e:docker`.
3. If the change is intended, bless only that region: `E2E_REGIONS=<id> npm run test:e2e:bless`. Commit `e2e/visual/diff-baseline.json`.

`e2e/README.md` explains the metrics, the regression gate and its tolerances. When support for a MapLibre feature changes, also update the coverage table at the end of the root README.

## Releasing

Only when asked. The user runs `npm run release [patch|minor|major|x.y.z]`, which is interactive; `-- --dry-run` changes nothing. It must run on an up-to-date `main` with nothing uncommitted except `CHANGELOG.md`.

- The script pushes pending commits, waits for CI, bumps every `package.json`, dates the changelog, then commits and pushes the tag `vX.Y.Z`.
- The tag starts `.github/workflows/release.yml`, which refuses commits not on `main`. It tests, then waits for a maintainer to approve the `npm` GitHub environment.
- It then publishes the tested tarballs through npm trusted publishing with provenance, and creates the GitHub release with `maplibre-svg-export.tar.gz`. No npm token exists.
- Prerelease versions such as `2.5.0-rc.0` get the npm dist-tag `next`.
- If a release fails, run `npm run release` again; it offers to finish it. Re-runs skip versions already on npm.
- Unlike most Node repos here, `npm run release` doesn't run `vrt release-npm`. It runs `scripts/release.ts`.
- A new package name must be published once by hand before trusted publishing can be configured.

Commit types drive the recommended version: `feat` is minor, `fix` and `perf` are patch, and breaking changes are major. Changelog notes belong under `## [Unreleased]`. The script flags `feat`, `fix`, `perf` and breaking commits that didn't touch `CHANGELOG.md`.

## Decisions not to reopen

- `@napi-rs/canvas` over node-canvas, after a hands-on comparison: node-canvas ignores `ctx.filter`, can't decode WebP or WOFF2, and its install script is blocked by npm 12 and later. This needs new evidence to revisit.
- `PNGMapRenderer extends SVGMapRenderer`: one class hierarchy, not an abstract core with two siblings.
- Renderer options: `labels` (which replaced the deprecated `renderLabels`) and `fonts` per instance, `scale` per view.
- The tile cache remembers 404 and 204 as missing and never caches failed fetches.
- `SVGExportControl` uses `renderToSVG`, not a long-lived `SVGMapRenderer`.
- `text-halo-blur` is left out on purpose: sharp halos come closer to MapLibre's faint ones.

## Pitfalls

- Host screenshots aren't a valid measurement. `npm run test:e2e:screenshots` on macOS moves some regions by whole percentage points, so it can also fail inside `npm run check` without a real regression. Trust and bless the Docker numbers.
- Docker runs as x86-64 like CI, emulated on Apple silicon. `E2E_DOCKER_PLATFORM=linux/arm64` is faster but moves `png` and `drift` by up to 0.05 points, so don't bless from it.
- `svg` varies by up to 0.08 points between runs of the same commit in the container. If a re-blessed value fails on CI, keep the higher figure.
- Labels are off in all regions except `berlin-labels-vector` with its rotated twin, `parity-symbols` and `parity-anchors`. A label change won't show up elsewhere.
- `core`, `svg-renderer` and `maplibre-svg-export` run in browsers, so they must not import `node:*`. Outside its tests, core only has type imports of `@napi-rs/canvas`; png-renderer injects the factory.
- A library bundled into the packages belongs in the root `devDependencies`, not in a package's `dependencies`. Public `.d.ts` files inline those types, so each package must still typecheck for consumers. `npm run test:pack` checks that.
- The plugin has no runtime dependency on `maplibre-gl`. Its e2e test runs on MapLibre GL JS 5 with the ES module and on 6 with the UMD build, so both must keep working.
- `*.png` is gitignored. Generate PNG fixtures in code, as `e2e/shared/fixtures.ts` does, because a new PNG file silently won't be committed.
- Vitest's default config excludes `e2e/`, so `npm test` skips `*.test.ts` files there. They run with `vitest.e2e.config.ts` as part of `npm run test:e2e`.
- The e2e request cache in `e2e/.cache/` needs one run with network access; later runs are offline and deterministic.
- CI's e2e job needs the Playwright image to match the version in `package-lock.json` exactly. It's resolved from the lockfile in `ci.yml`, `pages.yml` and `scripts/e2e-docker.ts`.
