# End-to-end tests

Automated checks that render real maps and compare the SVG renderer against
MapLibre GL. Run the whole suite with `npm run test:e2e`.

## Entry points

| File                  | What it does                                                                                                                                                                                                     | Run                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `render.test.ts`      | Renders sample styles and asserts on the SVG output.                                                                                                                                                             | `npm run test:e2e` (vitest)    |
| `screenshots.ts`      | Renders each region with both the SVG renderer and MapLibre (at 2× device pixel ratio, so anti-aliasing is a smaller fraction of the diff), pixel-diffs them, and writes an HTML report to `output/report.html`. | `npm run test:e2e:screenshots` |
| `maplibre-control.ts` | Drives the MapLibre `SVGExportControl` plugin in a headless browser and checks the export flow.                                                                                                                  | `npm run test:e2e:maplibre`    |

## Shared helpers

| File             | What it provides                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.ts`      | The `regions` under test and `getStyle()` (used by both `screenshots.ts` and other harnesses).                                                                                   |
| `fetch-cache.ts` | An on-disk cache/proxy for upstream requests (tiles, sprite, glyphs, maplibre-gl) so runs are deterministic and offline after one warm run. Cached under `.cache/` (gitignored). |

Generated screenshots, diffs, and the report land in `output/` (gitignored).

A manual, open-in-a-browser demo of the export control lives in `../demo/`.

## Regression gate (`screenshots.ts`)

Each region's SVG-vs-MapLibre diff is compared to `diff-baseline.json` (the
last-blessed diff per region), and the run **exits non-zero** (failing CI) on:

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
