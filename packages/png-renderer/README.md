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
import { inlineSources, osm } from '@versatiles/style';
import { writeFile } from 'node:fs/promises';

// inlineSources() resolves the style's TileJSON sources into tile URLs, which the
// renderer needs. Without it, the map comes out empty.
const style = await inlineSources(osm({ theme: 'colorful' }));

const png = await renderToPNG({
	style,
	width: 800,
	height: 600,
	lon: 13.4,
	lat: 52.5,
	zoom: 10,
	scale: 2, // 1600 × 1200 pixels
});

await writeFile('map.png', png);
```

The same style, view and options also work with `renderToSVG`, imported from this package:

```typescript
import { renderToSVG } from '@versatiles/png-renderer';

const svg = await renderToSVG({ style, width: 800, height: 600, lon: 13.4, lat: 52.5, zoom: 10 });
```

> [!IMPORTANT]
> The style's sources must list their tile URLs directly (`"tiles": [...]`). A source that only points at a TileJSON document (`"url": ".../tiles.json"`) is **not fetched, and the map comes out empty without an error**. Styles built with `@versatiles/style` are in that form, so pass them through its `inlineSources()` as above.

### Many views of one style

`renderToPNG` starts from scratch on every call. To render many views of one style, create a `PNGMapRenderer` once. It parses the style once, fetches the sprite once, keeps the tiles it fetched, and keeps decoded images, so overlapping views share them. It renders SVG too, from the same tiles:

```typescript
import { PNGMapRenderer } from '@versatiles/png-renderer';

const map = new PNGMapRenderer({ style });

for (const [name, lon, lat] of [
	['berlin', 13.4, 52.52],
	['potsdam', 13.06, 52.4],
] as const) {
	await writeFile(
		`${name}.png`,
		await map.renderPNG({ lon, lat, zoom: 12, width: 800, height: 600, scale: 2 }),
	);
}

const svg = await map.renderSVG({ lon: 13.4, lat: 52.52, zoom: 12, width: 800, height: 600 });
```

### Drawing on the map, or saving another format

`renderCanvas` returns the canvas instead of a PNG file: a [`Canvas` of `@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas). Draw on it with its 2D context, then encode it in any format it supports — WebP, JPEG, AVIF or PNG. Its context is scaled by `scale`, so you draw in the same units as `width` and `height`.

```typescript
const map = new PNGMapRenderer({ style });
const view = { lon: 13.4, lat: 52.52, zoom: 12, width: 800, height: 600 };
const canvas = await map.renderCanvas(view);

const ctx = canvas.getContext('2d');
ctx.strokeStyle = '#000';
ctx.lineWidth = 4;
ctx.strokeRect(2, 2, 796, 596);

// Mark the Brandenburg Gate: project() gives its position in the same units.
const [x, y] = map.project(view, [13.3777, 52.5163])!;
ctx.fillStyle = '#e00';
ctx.beginPath();
ctx.arc(x, y, 8, 0, 2 * Math.PI);
ctx.fill();

await writeFile('berlin.webp', await canvas.encode('webp', 90));
```

`renderToCanvas(options)` does the same in one call, like `renderToPNG`.

### Caching tiles on disk

The renderer keeps tiles in memory while an instance lives. To keep them between runs, pass a `fetch` that stores responses on disk ([more on `fetch`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#loading-tiles-your-own-way)):

```typescript
import { PNGMapRenderer } from '@versatiles/png-renderer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cacheDir = 'tile-cache';
await mkdir(cacheDir, { recursive: true });

/** Like fetch, but keeps every successful response in `cacheDir`. */
async function cachedFetch(url: string): Promise<Response> {
	const file = join(cacheDir, createHash('sha256').update(url).digest('hex'));
	try {
		const { type, body } = JSON.parse(await readFile(file, 'utf8')) as {
			type: string;
			body: string;
		};
		return new Response(Buffer.from(body, 'base64'), { headers: { 'content-type': type } });
	} catch {
		// Not cached yet.
	}
	const response = await fetch(url);
	// Keep only what the server really has: a failed request must be tried again later.
	if (!response.ok) return response;
	const body = Buffer.from(await response.arrayBuffer());
	const type = response.headers.get('content-type') ?? 'application/octet-stream';
	await writeFile(file, JSON.stringify({ type, body: body.toString('base64') }));
	return new Response(body, { headers: { 'content-type': type } });
}

const map = new PNGMapRenderer({ style, fetch: cachedFetch });
```

The files never expire: delete the directory to fetch fresh tiles.

### Labels in the style's own fonts

A style only _names_ its fonts (`"text-font": ["noto_sans_regular"]`). Map each name to a font file (TTF, OTF, WOFF or WOFF2) with `fonts`. A name left unmapped falls back to a font installed on the machine.

```typescript
// The VersaTiles styles use Noto Sans, e.g. from `npm install @fontsource/noto-sans`.
const files = 'node_modules/@fontsource/noto-sans/files';

const png = await renderToPNG({
	style,
	lon: 13.4,
	lat: 52.5,
	zoom: 14,
	renderLabels: true,
	fonts: {
		noto_sans_regular: `${files}/noto-sans-latin-400-normal.woff2`,
		noto_sans_bold: `${files}/noto-sans-latin-700-normal.woff2`,
	},
});
```

## API

### `renderToPNG(options): Promise<Uint8Array>`

Takes every option of [`renderToSVG`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#api) (`style`, `width`, `height`, `lon`, `lat`, `zoom`, `renderLabels`, `fetch`), plus:

| Option  | Type                     | Default | Description                                                                                          |
| ------- | ------------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `scale` | `number`                 | `1`     | Pixel density: the image is `width × scale` by `height × scale` pixels. Use `2` for sharp output.    |
| `fonts` | `Record<string, string>` | —       | Font files for labels, by the `text-font` name the style uses: `{ noto_sans_regular: 'path.woff2' }` |

The result is typed as a `Uint8Array` so the package does not require Node's type definitions; at runtime it is a `Buffer` and can be written with `fs.writeFile` as is.

Label rendering has the same limitations as in SVG output: [see `renderLabels`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#about-renderlabels).

### `new PNGMapRenderer(options)`

An [`SVGMapRenderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#new-svgmaprendereroptions) that can also render PNG. It takes the options of `SVGMapRenderer` (`style`, `renderLabels`, `tileCacheSize`, `fetch`), plus `fonts` as above.

- **`renderPNG(view?): Promise<Uint8Array>`** renders one view as PNG. `view` takes `width`, `height`, `lon`, `lat`, `zoom` and `scale`, with the same defaults as `renderToPNG`.
- **`renderCanvas(view?): Promise<Canvas>`** renders one view onto a canvas, to draw on or to encode in another format; see [above](#drawing-on-the-map-or-saving-another-format).
- **`renderSVG(view?): Promise<string>`** renders one view as SVG, sharing the tiles and the sprite with the PNG renders.
- **`project(view, [lon, lat])`** tells where a coordinate lands in the image of `view`, as on [`SVGMapRenderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#new-svgmaprendereroptions).
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
