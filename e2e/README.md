# End-to-end tests

Automated checks that render real maps and compare the SVG renderer against
MapLibre GL. Run the whole suite with `npm run test:e2e`.

## Entry points

| File                  | What it does                                                                                                                                                                                                                                 | Run                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `render.test.ts`      | Renders sample styles and asserts on the SVG output.                                                                                                                                                                                         | `npm run test:e2e` (vitest)    |
| `screenshots.ts`      | Renders each region three ways — SVG renderer, PNG (canvas) renderer, and MapLibre (all at 2× device pixel ratio, so anti-aliasing is a smaller fraction of the diff) — pixel-diffs them, and writes an HTML report to `output/report.html`. | `npm run test:e2e:screenshots` |
| `maplibre-control.ts` | Drives the MapLibre `SVGExportControl` plugin in a headless browser and checks the export flow.                                                                                                                                              | `npm run test:e2e:maplibre`    |

## Shared helpers

| File             | What it provides                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.ts`      | The `regions` under test and `getStyle()` (used by both `screenshots.ts` and other harnesses).                                                                                   |
| `fetch-cache.ts` | An on-disk cache/proxy for upstream requests (tiles, sprite, glyphs, maplibre-gl) so runs are deterministic and offline after one warm run. Cached under `.cache/` (gitignored). |

Generated screenshots, diffs, and the report land in `output/` (gitignored).

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

Labels and icons are switched off in every region but `berlin-labels-vector`.
MapLibre draws text from SDF glyphs while both renderers use system fonts, so the
difference is large and inherent; confining it to one region keeps it measured
without letting it dominate every other diff.

## Regression gate (`screenshots.ts`)

Each of the three metrics is compared to `diff-baseline.json` (the last-blessed
value per region and metric), and the run **exits non-zero** (failing CI) on:

- **degradation** — the diff rose beyond both 5% relative and a 0.1% absolute
  floor (below that is MapLibre AA/GPU noise). Shown in red.
- **ceiling breach** — the diff exceeded `max(baseline × 1.5, baseline + 0.3%)`,
  a hard backstop derived from the baseline (no separate value to maintain).
- **missing screenshot** — a render crashed.

A **surprising improvement** (fallen beyond the same tolerance) is highlighted in
green but does not fail — it's a nudge to re-bless. Regions with no baseline yet
are informational only.

When a change is intentional (you improved the renderer, or accept a new diff),
re-bless the baseline:

```sh
UPDATE_BASELINE=1 npm run test:e2e:screenshots
```

then commit the updated `diff-baseline.json`.

A baseline entry may be a bare number, which is read as the `svg` metric alone —
the form the file used before the PNG renderer existed. Re-blessing rewrites it as
`{ "svg": …, "png": …, "drift": … }`.
