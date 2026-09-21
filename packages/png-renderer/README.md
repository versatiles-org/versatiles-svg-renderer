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

Takes every option of [`renderToSVG`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#api) (`style`, `width`, `height`, `lon`, `lat`, `zoom`, `renderLabels`), plus:

| Option  | Type                     | Default | Description                                                                                          |
| ------- | ------------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `scale` | `number`                 | `1`     | Pixel density: the image is `width × scale` by `height × scale` pixels. Use `2` for sharp output.    |
| `fonts` | `Record<string, string>` | —       | Font files for labels, by the `text-font` name the style uses: `{ noto_sans_regular: 'path.woff2' }` |

The result is typed as a `Uint8Array` so the package does not require Node's type definitions; at runtime it is a `Buffer` and can be written with `fs.writeFile` as is.

Label rendering has the same limitations as in SVG output: [see `renderLabels`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#about-renderlabels).

### `renderToSVG(options): Promise<string>`

The same function as in [`@versatiles/svg-renderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#api).

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

## License

MIT. Part of [VersaTiles](https://github.com/versatiles-org/versatiles-svg-renderer): source code, issues and the changelog are on GitHub.
