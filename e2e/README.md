# End-to-end tests

Automated checks that render real maps and compare the SVG renderer against
MapLibre GL. Run the whole suite with `npm run test:e2e`.

## Layout

Three kinds of test, one folder each, and what they share:

| Folder         | What it checks                                                                                                                                                                                                                                                                                   | Run                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `visual/`      | Renders each region three ways — MapLibre, the SVG renderer and the PNG renderer, all at 2× device pixel ratio, so anti-aliasing is a smaller fraction of the diff — pixel-diffs them against their baseline, and writes an HTML report to `output/report.html`. See below.                      | `npm run test:e2e:screenshots` |
| `plugin/`      | Drives the `SVGExportControl` plugin in a headless browser and checks the export flow, including that the map stops responding while the panel is open. Runs twice: MapLibre GL JS 5 with the plugin's ES module build, and MapLibre GL JS 6 (from `node_modules`) with its minified UMD build.  | `npm run test:e2e:maplibre`    |
| `integration/` | Renders sample styles through the pipeline and asserts on the SVG output.                                                                                                                                                                                                                        | `npm run test:e2e` (vitest)    |
| `shared/`      | `fetch-cache.ts`, an on-disk cache for upstream requests (tiles, sprites, glyphs, maplibre-gl), so runs are deterministic and offline after one warm run; `fixtures.ts`, files the tests make themselves; `maplibre-page.ts`, the page MapLibre runs in. Also used by `../bench/` and `../dev/`. |                                |

`npm run test:e2e` runs all of it: the vitest files (`integration/` and the unit tests of the
helpers), then `plugin/`, then `visual/`.

In `visual/`:

| File                 | What it does                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`             | The run: selects regions, renders, measures, prints one line per region, writes the report, and blesses the baseline or fails.                                                                |
| `regions.ts`         | The regions under test: each an `id` (its key in `diff-baseline.json`), the style it draws and its `view`.                                                                                    |
| `styles.ts`          | `getStyle()`, the style of a region, and the fonts the styles name.                                                                                                                           |
| `scenes/`            | Hand-made styles: `geojson.ts`, and the grids of single-feature checks `features.ts`, `symbols.ts` and `sources.ts`, built with `grid.ts`; `test-sprite.ts` and `test-image.ts` are fixtures. |
| `capture.ts`         | Renders a region three ways.                                                                                                                                                                  |
| `compare.ts`         | Measures the diffs, per region and per cell of a grid scene (`cells.ts`), and grades them against the baseline (with its tests).                                                              |
| `report.ts`          | Writes the HTML report.                                                                                                                                                                       |
| `output.ts`          | The image size and the output folders.                                                                                                                                                        |
| `diff-baseline.json` | The blessed metrics per region.                                                                                                                                                               |

The request cache (`.cache/`) and the generated screenshots, diffs and report (`output/`)
stay in this folder, gitignored.

A manual, open-in-a-browser demo of the export control lives in `../demo/`.

## What is measured

MapLibre is the reference. Each region yields three numbers:

| Metric  | Compares                     | Catches                                                      |
| ------- | ---------------------------- | ------------------------------------------------------------ |
| `svg`   | SVG renderer vs MapLibre     | the SVG backend drifting from the reference                  |
| `png`   | PNG renderer vs MapLibre     | the canvas backend drifting from the reference               |
| `drift` | SVG renderer vs PNG renderer | one backend diverging even while both stay close to MapLibre |

The PNG renderer runs in process (no browser), and its output is flattened onto
white before diffing: it leaves unpainted areas transparent — most visibly around
the globe — while both screenshots come off a white page, so an unflattened diff
would report every unpainted pixel as a mismatch.

The `parity-*` regions draw scenes that check single MapLibre features, one per cell of a
3 × 3 grid, so a mismatch in the diff image points straight at its cell:
`visual/scenes/features.ts` (sort keys, circle opacities and blur, `line-gap-width`,
`global-state`, fill patterns), `visual/scenes/symbols.ts` (`icon-text-fit` with
stretchable icons, a turned icon) and `visual/scenes/sources.ts` (`image` sources: a
rectangle, a parallelogram, in perspective, strongly foreshortened, mirrored, translucent). Each cell is one object: a title, and a function that
builds its sources and layers around the cell's center. When a renderer gains a feature
MapLibre has, give it a cell in a scene (or start a new scene, with a region of its
own), so its diff is measured without the noise of a real map.

For these regions, each cell is also measured on its own: the part of the image nearest
to the cell's center. The report lists every cell's three numbers, and the console prints a
cell that changed beyond the gate's tolerance below its region's line, so a change points
straight at the feature. The cells' numbers are stored with the region's in
`diff-baseline.json`, but only the region's own numbers can fail the run.

The symbols' sprite (`visual/scenes/test-sprite.ts`) has what the VersaTiles sprites lack,
stretchable images. It is a fixture (`shared/fixtures.ts`): drawn when first asked for, and
served under an address that does not exist, where MapLibre and the renderers find it.
So is the image of the `image` sources (`visual/scenes/test-image.ts`).

To run only some regions, name them: `E2E_REGIONS=parity-features,berlin-vector npm run
test:e2e:screenshots`. With `UPDATE_BASELINE=1`, such a run re-blesses only those
regions.

### Measuring as CI does

CI and the Pages workflow run the e2e tests in the Playwright container (the image of the
installed Playwright version). `npm run test:e2e:docker` runs the screenshots in the same
container, with Docker, so it measures what CI measures; the baseline is blessed there:

```sh
npm run test:e2e:docker                                  # the screenshots
E2E_REGIONS=parity-features npm run test:e2e:docker      # some regions
UPDATE_BASELINE=1 npm run test:e2e:docker                # bless the baseline
npm run test:e2e:docker -- npm run test:e2e              # any command
```

It runs as x86-64, like CI's runners, also on Apple silicon, where Docker emulates it (a
full run takes some minutes longer). Natively on ARM (`E2E_DOCKER_PLATFORM=linux/arm64`) it
is faster, but the PNG renderer draws edges a little differently there, which moves `png`
and `drift` by up to 0.05 points. The dependencies are installed in the container, into a
Docker volume, and again when `package-lock.json` changes.

`npm run test:e2e:screenshots` on the host measures differently: macOS draws text and
edges differently, and some regions move by whole percentage points.

`berlin-outlines-vector` adds line layers on polygons (building and translucent water
outlines) to the VersaTiles style, which has none.

The `*-rotated` and `*-padded` regions are rendered with a `bearing` or `padding`,
compared with MapLibre with the same.

Labels and icons are switched off in every region but `berlin-labels-vector` (and its
rotated twin) and `parity-symbols`.
MapLibre draws text from SDF glyphs while both renderers use system fonts, so the
difference is large and inherent; confining it to one region keeps it measured
without letting it dominate every other diff.

## Regression gate (`visual/compare.ts`)

Each of the three metrics is compared to `visual/diff-baseline.json` (the last-blessed
value per region and metric), and the run **exits non-zero** (failing CI) on:

- **degradation** — the diff rose beyond both 10% relative and a 0.1 percentage-
  point floor. Shown in red.
- **ceiling breach** — the diff exceeded `max(baseline × 1.5, baseline + 0.5%)`,
  a hard backstop derived from the baseline (no separate value to maintain).
- **missing screenshot** — a render crashed.

### Why the tolerances are loose

The baseline is measured in the same container CI runs in (see above), but the same
commit still does not always measure the same there: Chromium rasterizes some SVGs a
little differently from run to run, and a region's `svg` can move by up to 0.08 points
between two runs (`berlin-vector`, `berlin-padded-vector`). On the host, macOS moves text
by whole percentage points. The tolerances leave room for both; when a re-blessed value
turns out to fail on CI, keep the higher figure.

A **surprising improvement** (fallen beyond the same tolerance) is highlighted in
green but does not fail — it's a nudge to re-bless. Regions with no baseline yet
are informational only.

When a change is intentional (you improved the renderer, or accept a new diff),
re-bless the baseline:

```sh
UPDATE_BASELINE=1 npm run test:e2e:docker
```

then commit the updated `visual/diff-baseline.json`.

A baseline entry may be a bare number, which is read as the `svg` metric alone —
the form the file used before the PNG renderer existed. Re-blessing rewrites it as
`{ "svg": …, "png": …, "drift": … }`.
