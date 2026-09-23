[![npm](https://img.shields.io/npm/v/%40versatiles%2Fsvg-renderer)](https://www.npmjs.com/package/@versatiles/svg-renderer)
[![CI status](https://img.shields.io/github/actions/workflow/status/versatiles-org/versatiles-svg-renderer/ci.yml)](https://github.com/versatiles-org/versatiles-svg-renderer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/LICENSE)

# @versatiles/svg-renderer

Renders MapLibre styles as SVG, in Node.js or the browser.

The result is a single self-contained SVG document: vector layers become paths, raster tiles and icons are embedded, and nothing refers to external files. It can be saved, inlined into HTML or edited in a vector editor.

![Example: rendered map view](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/docs/demo.svg)

Supported layer types: background, fill, line, circle, symbol, and raster.

**[API documentation](https://versatiles.org/versatiles-svg-renderer/doc-typescript/)** · **[Visual comparison with MapLibre](https://versatiles.org/versatiles-svg-renderer/e2e/report.html)**

> [!TIP]
> **Need PNG output?** Use [`@versatiles/png-renderer`](https://www.npmjs.com/package/@versatiles/png-renderer). It renders PNG in Node.js and includes this package's `renderToSVG` as well.
>
> **Want an "export as SVG" button on a MapLibre map?** Use [`@versatiles/maplibre-svg-export`](https://www.npmjs.com/package/@versatiles/maplibre-svg-export).

## Installation

```bash
npm install @versatiles/svg-renderer
```

No native code. The only dependency is `@types/geojson` (types only). The package is ESM; Node.js 22 or later, or any modern bundler.

## Usage

```typescript
import { renderToSVG } from '@versatiles/svg-renderer';

const url = 'https://tiles.versatiles.org/assets/styles/colorful/style.json';
const style = await (await fetch(url)).json();

const svg = await renderToSVG({ style, lon: 13.4, lat: 52.5, zoom: 10 });
```

The result is an SVG document as a string: write it to a file, or put it into a web page. This works the same in Node.js and in the browser. Without `width` and `height`, the image is 1024 × 1024 pixels.

A source may list its tile URLs (`"tiles": [...]`) or point at a TileJSON document (`"url": "…/tiles.json"`). The renderer fetches a TileJSON document once per `SVGMapRenderer` and takes `tiles`, `minzoom`, `maxzoom` and the like from it, unless the style sets them, as MapLibre GL JS does.

### Many views of one style

`renderToSVG` starts from scratch on every call. To render many views of one style, create an `SVGMapRenderer` once: it parses the style once and keeps the tiles it has fetched.

```typescript
import { SVGMapRenderer } from '@versatiles/svg-renderer';

const map = new SVGMapRenderer({ style });

const berlin = await map.renderSVG({ lon: 13.4, lat: 52.52, zoom: 12 });
const potsdam = await map.renderSVG({ lon: 13.06, lat: 52.4, zoom: 12 });
```

## API

### `renderToSVG(options): Promise<string>`

| Option         | Type                 | Default                    | Description                                                                            |
| -------------- | -------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `style`        | `StyleSpecification` | _(required)_               | MapLibre style specification                                                           |
| `width`        | `number`             | `1024`                     | Output width in pixels                                                                 |
| `height`       | `number`             | `1024`                     | Output height in pixels                                                                |
| `lon`          | `number`             | style's `center`, else `0` | Center longitude                                                                       |
| `lat`          | `number`             | style's `center`, else `0` | Center latitude                                                                        |
| `zoom`         | `number`             | style's `zoom`, else `2`   | Zoom level                                                                             |
| `renderLabels` | `boolean`            | `false`                    | Enable rendering of text labels and icons                                              |
| `fetch`        | `FetchFunction`      | global `fetch`             | Loads tiles and sprites; see [Loading tiles your own way](#loading-tiles-your-own-way) |
| `onWarning`    | `(message) => void`  | `console.warn`             | Reports parts of the style that are not drawn; see [Warnings](#warnings)               |
| `globalState`  | `GlobalState`        | style's `state`            | Values for `global-state` expressions, over the style's defaults                       |

### `new SVGMapRenderer(options)`

Renders many views of one style. The options stay the same for every view:

| Option          | Type                 | Default              | Description                                                                               |
| --------------- | -------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `style`         | `StyleSpecification` | _(required)_         | MapLibre style specification. Read once: to render a changed style, create a new instance |
| `renderLabels`  | `boolean`            | `false`              | Enable rendering of text labels and icons                                                 |
| `tileCacheSize` | `number`             | `134217728` (128 MB) | How much memory fetched tiles may take, in bytes. `0` keeps none                          |
| `fetch`         | `FetchFunction`      | global `fetch`       | Loads tiles and sprites; see [Loading tiles your own way](#loading-tiles-your-own-way)    |
| `onWarning`     | `(message) => void`  | `console.warn`       | Reports parts of the style that are not drawn; see [Warnings](#warnings)                  |
| `globalState`   | `GlobalState`        | style's `state`      | Values for `global-state` expressions, over the style's defaults                          |

- **`renderSVG(view?): Promise<string>`** renders one view. `view` takes `width`, `height`, `lon`, `lat` and `zoom`, with the same defaults as `renderToSVG`. Renders may run concurrently.
- **`project(view, [lon, lat]): [x, y] | undefined`** tells where a coordinate lands in the image of `view`, in the units of `width` and `height`, to place your own drawing on the map. On the globe, a point on the far side gives `undefined`.
- **`unproject(view, [x, y]): [lon, lat] | undefined`** is the opposite: the coordinate shown at a position in the image, e.g. where a user clicked. It gives `undefined` where the image shows no map: next to the globe, or beyond the poles of the mercator map (about ±85°).
- **`clearCache()`** forgets the fetched tiles and sprite, e.g. after they were updated on the server.

Tiles are kept for the lifetime of the instance, regardless of their HTTP caching headers; beyond `tileCacheSize`, the least recently used ones are dropped. A tile the server does not have (404) is remembered as missing; a failed request (network error, server error) is not, so the next render tries again.

### Loading tiles your own way

Tiles and sprites are loaded with the global `fetch`, unless you pass your own function as `fetch`: `(url: string) => Promise<Response>`. Use it to send headers (an API key, say), go through a proxy, or keep tiles on disk between runs — see [Caching tiles on disk](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/png-renderer/README.md#caching-tiles-on-disk) for an example in Node.js.

```typescript
const map = new SVGMapRenderer({
	style,
	fetch: (url) => fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
});
```

It must return a real `Response`, and the status counts: a 404 or 204 means the server has no such tile, and the renderer remembers that; any other error status, or a rejected promise, counts as failed, so the next render tries again. The renderer asks it for tiles, sprites, and the TileJSON documents and GeoJSON data of the style's sources.

### About `renderLabels`

When `renderLabels` is set to `true`, symbol layers are rendered, including text labels and sprite-based icons. By default, this option is disabled.

The SVG names each label's font (`text-font`) and leaves resolving it to whatever displays the SVG, so labels use the intended typeface only where that font is installed or provided with `@font-face`.

> [!WARNING]
> The rendering of labels and icons is experimental and may produce imperfect results. Since we cannot use the original layouting engine of MapLibre GL JS, there are known limitations:
>
> - **Text measured with Noto Sans:** Labels are placed and kept apart as in MapLibre GL JS, and street names follow their streets glyph by glyph, but text is measured with the widths of Noto Sans (the font of the VersaTiles styles). In other fonts, labels keep a little too much or too little distance, and letters along a line sit a little apart or close together.
>
> Which MapLibre GL JS features are covered, and which are not yet: [MapLibre GL JS Coverage](https://github.com/versatiles-org/versatiles-svg-renderer#maplibre-gl-js-coverage).

### Warnings

Parts of a style the renderer does not draw are reported, not skipped silently: layer types such as `fill-extrusion` or `heatmap`, properties such as `fill-pattern`, unsupported sources, and TileJSON documents or GeoJSON data that could not be loaded. Each message goes to `onWarning`, once per renderer, by default to `console.warn`:

```ts
const map = new SVGMapRenderer({ style, onWarning: (message) => warnings.push(message) });
```

Pass `onWarning: () => {}` to silence them. Properties that make no difference to a flat, north-up map (e.g. `*-pitch-alignment`) are not reported, nor are symbol layers unless `renderLabels` is set. The [MapLibre GL JS coverage table](https://github.com/versatiles-org/versatiles-svg-renderer#maplibre-gl-js-coverage) lists what is supported.

### Projections

The renderer follows the style's [`projection`](https://maplibre.org/maplibre-style-spec/projection/): `mercator` (the default), `vertical-perspective` and `globe`, which — like in MapLibre GL JS — shows the globe up to zoom 11 and blends into mercator between zoom 11 and 12. Zoom-dependent `step`/`interpolate` expressions are supported as well. On the globe, geometry is clipped at the horizon and the map is clipped to the globe's outline; everything outside of it stays transparent. Raster tiles are drawn as a mesh of small triangles, each mapped exactly onto the globe by its own affine transform.

## Dependency Graph

<!--- This chapter is generated automatically --->

[![Dependency graph](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/svg-renderer/docs/dependency-graph.svg)](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/svg-renderer/docs/dependency-graph.svg)

## License

MIT. Part of [VersaTiles](https://github.com/versatiles-org/versatiles-svg-renderer): source code, issues and the changelog are on GitHub.
