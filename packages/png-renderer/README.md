[![npm](https://img.shields.io/npm/v/%40versatiles%2Fpng-renderer)](https://www.npmjs.com/package/@versatiles/png-renderer)
[![CI status](https://img.shields.io/github/actions/workflow/status/versatiles-org/versatiles-svg-renderer/ci.yml)](https://github.com/versatiles-org/versatiles-svg-renderer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/LICENSE)

# @versatiles/png-renderer

Renders MapLibre styles as PNG in Node.js, with no browser and no SVG rasterizer involved. Satellite and other raster tiles in WebP work too.

It also exports `renderToSVG`, so one package covers both formats.

**[API documentation](https://versatiles.org/versatiles-svg-renderer/doc-typescript/)** · **[Visual comparison with MapLibre](https://versatiles.org/versatiles-svg-renderer/e2e/report.html)**

> [!TIP]
> **Only need SVG, or want to avoid a native dependency?** Use [`@versatiles/svg-renderer`](https://www.npmjs.com/package/@versatiles/svg-renderer). It has the same `renderToSVG`, runs in the browser too, and contains no native code.

## Installation

```bash
npm install @versatiles/png-renderer
```

The package draws with [`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas) (Skia), which npm installs with it, including the prebuilt binary for your platform. There is no install script and nothing to compile. The package is ESM and needs Node.js 22 or later.

## Usage

```typescript
import { renderToPNG } from '@versatiles/png-renderer';
import { writeFile } from 'node:fs/promises';

const url = 'https://tiles.versatiles.org/assets/styles/colorful/style.json';
const style = await (await fetch(url)).json();

const png = await renderToPNG({ style, lon: 13.4, lat: 52.5, zoom: 10 });
await writeFile('map.png', png);
```

Add `scale: 2` for twice the pixels, sharp on high-resolution screens. `renderToSVG` is exported by this package too and takes the same options. The style must list its tile URLs, as described for [`@versatiles/svg-renderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#usage).

### Many views of one style

`renderToPNG` starts from scratch on every call. To render many views of one style, create a `PNGMapRenderer` once: it parses the style once and keeps the tiles and images it has loaded — for PNG and SVG alike.

```typescript
import { PNGMapRenderer } from '@versatiles/png-renderer';

const map = new PNGMapRenderer({ style });

const berlin = await map.renderPNG({ lon: 13.4, lat: 52.52, zoom: 12 });
const potsdam = await map.renderPNG({ lon: 13.06, lat: 52.4, zoom: 12 });
const svg = await map.renderSVG({ lon: 13.4, lat: 52.52, zoom: 12 });
```

### Drawing on the map, or saving another format

`renderCanvas` returns the canvas instead of a PNG file: a [`Canvas` of `@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas). Draw on it, then encode it as WebP, JPEG, AVIF or PNG. `project` gives the position of a coordinate on it.

```typescript
const view = { lon: 13.4, lat: 52.52, zoom: 12 };
const canvas = await map.renderCanvas(view);

const [x, y] = map.project(view, [13.3777, 52.5163])!; // the Brandenburg Gate
const ctx = canvas.getContext('2d');
ctx.beginPath();
ctx.arc(x, y, 8, 0, 2 * Math.PI);
ctx.fill();

await writeFile('berlin.webp', await canvas.encode('webp'));
```

### Caching tiles on disk

To keep tiles between runs, pass a `fetch` that stores them on disk. [`examples/cached-fetch.ts`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/png-renderer/examples/cached-fetch.ts) is one, in about 25 lines:

```typescript
const map = new PNGMapRenderer({ style, fetch: cachedFetch });
```

### Labels in the style's own fonts

With `labels: 'glyphs'` (or `'glyphs-text'`), labels are drawn as the style's own glyphs, the letter shapes MapLibre GL JS draws, and need no font files.

With `labels: 'text'`, labels are drawn in fonts: a style only _names_ its fonts (`"text-font": ["noto_sans_regular"]`). Map each name to a font file (TTF, OTF, WOFF or WOFF2) with `fonts`; a name left unmapped falls back to a font installed on the machine.

```typescript
const png = await renderToPNG({
	style,
	lon: 13.4,
	lat: 52.5,
	zoom: 14,
	labels: 'text',
	fonts: {
		noto_sans_regular: 'fonts/NotoSans-Regular.ttf',
		noto_sans_bold: 'fonts/NotoSans-Bold.ttf',
	},
});
```

The VersaTiles styles use Noto Sans. One source is `npm install @fontsource/noto-sans`, whose font files are in `node_modules/@fontsource/noto-sans/files`.

## API

### `renderToPNG(options): Promise<Uint8Array>`

Takes every option of [`renderToSVG`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#api) (`style`, `width`, `height`, `lon`, `lat`, `zoom`, `labels`, `fetch` and more), plus:

| Option  | Type                     | Default | Description                                                                                                                |
| ------- | ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `scale` | `number`                 | `1`     | Pixel density: the image is `width × scale` by `height × scale` pixels. Use `2` for sharp output.                          |
| `fonts` | `Record<string, string>` | —       | Font files for labels with `labels: 'text'`, by the `text-font` name the style uses: `{ noto_sans_regular: 'path.woff2' }` |

The result is typed as a `Uint8Array` so the package does not require Node's type definitions; at runtime it is a `Buffer` and can be written with `fs.writeFile` as is.

Label rendering has the same limitations as in SVG output: [see "About labels"](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#about-labels). With `'glyphs'`, PNG and SVG show the same letter shapes; `'glyphs-text'` draws as `'glyphs'`, since a PNG has no text.

Which MapLibre GL JS features are covered, and which are not yet: [MapLibre GL JS Coverage](https://github.com/versatiles-org/versatiles-svg-renderer#maplibre-gl-js-coverage).

### `new PNGMapRenderer(options)`

An [`SVGMapRenderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#new-svgmaprendereroptions) that can also render PNG. It takes the options of `SVGMapRenderer` (`style`, `renderLabels`, `tileCacheSize`, `fetch`), plus `fonts` as above.

- **`renderPNG(view?): Promise<Uint8Array>`** renders one view as PNG. `view` takes `width`, `height`, `lon`, `lat`, `zoom` and `scale`, with the same defaults as `renderToPNG`.
- **`renderCanvas(view?): Promise<Canvas>`** renders one view onto a canvas, to draw on or to encode in another format; see [above](#drawing-on-the-map-or-saving-another-format).
- **`renderSVG(view?): Promise<string>`** renders one view as SVG, sharing the tiles and the sprite with the PNG renders.
- **`project(view, [lon, lat])`** and **`unproject(view, [x, y])`** convert between coordinates and positions in the image of `view`, as on [`SVGMapRenderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#new-svgmaprendereroptions).
- **`clearCache()`** forgets the fetched tiles and sprite, and the decoded images.

A font that cannot be loaded is reported by `renderPNG`, and the next `renderPNG` tries again.

### `renderToCanvas(options): Promise<Canvas>`

Takes the options of `renderToPNG` and returns the canvas instead of the PNG file, like `renderCanvas`.

### TypeScript

The types of `renderCanvas` and `renderToCanvas` are those of `@napi-rs/canvas`, which use Node's types (`Buffer`, for one). A TypeScript project using this package therefore needs `@types/node`, as most Node.js projects have anyway, or `skipLibCheck`.

### `renderToSVG(options): Promise<string>` and `new SVGMapRenderer(options)`

The same as in [`@versatiles/svg-renderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#api).

## Platforms

`@napi-rs/canvas` ships prebuilt binaries for:

- macOS: x64, arm64
- Linux: x64 and arm64 (glibc and musl, e.g. Debian and Alpine images), arm (glibc), riscv64 (glibc)
- Windows: x64, arm64
- Android: arm64

### "PNG rendering needs the native module @napi-rs/canvas …"

This error means the binary for the platform was not installed. It names the platform and the missing package. The usual causes:

- **Dependencies were installed with `--omit=optional`** (or `--no-optional`). npm installs the platform binaries as optional dependencies.
- **`node_modules` was installed on another OS or CPU architecture and copied**, e.g. installed on macOS and then copied into a Linux Docker image. Install the dependencies inside the image instead (`npm ci` in the Dockerfile).

`renderToSVG` keeps working in either case, because the binary is only loaded when a PNG is rendered.

## Dependency Graph

<!--- This chapter is generated automatically --->

[![Dependency graph](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/png-renderer/docs/dependency-graph.svg)](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/png-renderer/docs/dependency-graph.svg)

## License

MIT. Part of [VersaTiles](https://github.com/versatiles-org/versatiles-svg-renderer): source code, issues and the changelog are on GitHub.
