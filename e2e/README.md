# End-to-end tests

Automated checks that render real maps and compare the SVG renderer against
MapLibre GL. Run the whole suite with `npm run test:e2e`.

## Entry points

| File                  | What it does                                                                                                                      | Run                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `render.test.ts`      | Renders sample styles and asserts on the SVG output.                                                                              | `npm run test:e2e` (vitest)    |
| `screenshots.ts`      | Renders each region with both the SVG renderer and MapLibre, pixel-diffs them, and writes an HTML report to `output/report.html`. | `npm run test:e2e:screenshots` |
| `maplibre-control.ts` | Drives the MapLibre `SVGExportControl` plugin in a headless browser and checks the export flow.                                   | `npm run test:e2e:maplibre`    |

## Shared helpers

| File             | What it provides                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styles.ts`      | The `regions` under test and `getStyle()` (used by both `screenshots.ts` and other harnesses).                                                                                   |
| `fetch-cache.ts` | An on-disk cache/proxy for upstream requests (tiles, sprite, glyphs, maplibre-gl) so runs are deterministic and offline after one warm run. Cached under `.cache/` (gitignored). |

Generated screenshots, diffs, and the report land in `output/` (gitignored).

A manual, open-in-a-browser demo of the export control lives in `../demo/`.
