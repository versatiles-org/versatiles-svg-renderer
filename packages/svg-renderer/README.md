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

### Node.js

```typescript
import { renderToSVG } from '@versatiles/svg-renderer';
import { inlineSources, osm } from '@versatiles/style';
import { writeFile } from 'node:fs/promises';

// inlineSources() resolves the style's TileJSON sources into tile URLs, which the
// renderer needs. Without it, the map comes out empty.
const style = await inlineSources(osm({ theme: 'colorful' }));

const svg = await renderToSVG({
	style,
	width: 800,
	height: 600,
	lon: 13.4,
	lat: 52.5,
	zoom: 10,
});

await writeFile('map.svg', svg);
```

> [!IMPORTANT]
> The style's sources must list their tile URLs directly (`"tiles": [...]`). A source that only points at a TileJSON document (`"url": ".../tiles.json"`) is **not fetched, and the map comes out empty without an error**. Styles built with `@versatiles/style` are in that form, so pass them through its `inlineSources()` as above. Hosted style files usually list their tiles already.

### Browser

```typescript
import { renderToSVG } from '@versatiles/svg-renderer';

const style = await fetch('https://tiles.versatiles.org/assets/styles/colorful/style.json').then(
	(r) => r.json(),
);

document.body.innerHTML = await renderToSVG({
	style,
	width: 800,
	height: 600,
	lon: 13.4,
	lat: 52.5,
	zoom: 10,
});
```

## API

### `renderToSVG(options): Promise<string>`

| Option         | Type                 | Default      | Description                               |
| -------------- | -------------------- | ------------ | ----------------------------------------- |
| `style`        | `StyleSpecification` | _(required)_ | MapLibre style specification              |
| `width`        | `number`             | `1024`       | Output width in pixels                    |
| `height`       | `number`             | `1024`       | Output height in pixels                   |
| `lon`          | `number`             | `0`          | Center longitude                          |
| `lat`          | `number`             | `0`          | Center latitude                           |
| `zoom`         | `number`             | `2`          | Zoom level                                |
| `renderLabels` | `boolean`            | `false`      | Enable rendering of text labels and icons |

### About `renderLabels`

When `renderLabels` is set to `true`, symbol layers are rendered, including text labels and sprite-based icons. By default, this option is disabled.

The SVG names each label's font (`text-font`) and leaves resolving it to whatever displays the SVG, so labels use the intended typeface only where that font is installed or provided with `@font-face`.

> [!WARNING]
> The rendering of labels and icons is experimental and may produce imperfect results. Since we cannot use the original layouting engine of MapLibre GL JS, there are known limitations:
>
> - **No collision detection:** Text labels are rendered without collision detection, so labels may overlap.
> - **Simplified text placement:** Labels can not be positioned along lines.

### Projections

The renderer follows the style's [`projection`](https://maplibre.org/maplibre-style-spec/projection/): `mercator` (the default), `vertical-perspective` and `globe`, which — like in MapLibre GL JS — shows the globe up to zoom 11 and blends into mercator between zoom 11 and 12. Zoom-dependent `step`/`interpolate` expressions are supported as well. On the globe, geometry is clipped at the horizon and the map is clipped to the globe's outline; everything outside of it stays transparent. Raster tiles are drawn as a mesh of small triangles, each mapped exactly onto the globe by its own affine transform.

## License

MIT. Part of [VersaTiles](https://github.com/versatiles-org/versatiles-svg-renderer): source code, issues and the changelog are on GitHub.
