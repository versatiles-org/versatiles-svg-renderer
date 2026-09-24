[![npm](https://img.shields.io/npm/v/%40versatiles%2Fmaplibre-svg-export)](https://www.npmjs.com/package/@versatiles/maplibre-svg-export)
[![CI status](https://img.shields.io/github/actions/workflow/status/versatiles-org/versatiles-svg-renderer/ci.yml)](https://github.com/versatiles-org/versatiles-svg-renderer/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/LICENSE)

# @versatiles/maplibre-svg-export

A [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) control that exports the current map view as SVG.

It adds a button to the map. Clicking it opens a panel with a live preview, where the user sets the image size, chooses whether to include labels and icons, and then downloads the SVG or opens it in a new tab. The map stops responding to panning and zooming while the panel is open, so the preview matches what is exported. The panel also shows the attribution of the style's sources.

**[Demo](https://versatiles.org/versatiles-svg-renderer/demo/index.html)** · **[API documentation](https://versatiles.org/versatiles-svg-renderer/doc-typescript/)**

> [!TIP]
> To render SVG or PNG without a map, e.g. on a server, use [`@versatiles/svg-renderer`](https://www.npmjs.com/package/@versatiles/svg-renderer) or [`@versatiles/png-renderer`](https://www.npmjs.com/package/@versatiles/png-renderer).

## Usage

### With a script tag

The bundle sets a global `VersaTilesSVG` with `SVGExportControl`, and with [`renderToSVG` and `SVGMapRenderer`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#api) for rendering maps yourself:

```html
<!doctype html>
<html>
	<head>
		<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
		<script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
		<script src="https://cdn.jsdelivr.net/npm/@versatiles/maplibre-svg-export@2"></script>
	</head>
	<body>
		<div id="map" style="height: 100vh"></div>
		<script>
			const map = new maplibregl.Map({
				container: 'map',
				style: 'https://tiles.versatiles.org/assets/styles/colorful/style.json',
				center: [13.4, 52.5],
				zoom: 10,
			});
			map.addControl(new VersaTilesSVG.SVGExportControl(), 'top-right');
		</script>
	</body>
</html>
```

`@2` follows the latest 2.x release. Pin an exact version (e.g. `@2.0.0`) for reproducible pages.

### With a bundler

```bash
npm install @versatiles/maplibre-svg-export
```

```typescript
import maplibregl from 'maplibre-gl';
import { SVGExportControl } from '@versatiles/maplibre-svg-export';

const map = new maplibregl.Map({
	container: 'map',
	style: 'https://tiles.versatiles.org/assets/styles/colorful/style.json',
	center: [13.4, 52.5],
	zoom: 10,
});

map.addControl(new SVGExportControl(), 'top-right');
```

The package has no dependency on `maplibre-gl`: it works with the one your page already uses, and TypeScript needs nothing beyond this package to typecheck it. Tested in the browser with MapLibre GL JS 5 and 6.

### Self-hosted

Every [GitHub release](https://github.com/versatiles-org/versatiles-svg-renderer/releases/latest) has a `maplibre-svg-export.tar.gz` with the files to host yourself:

| File                             | For                                               |
| -------------------------------- | ------------------------------------------------- |
| `maplibre-svg-export.umd.min.js` | `<script>` tags; sets the `VersaTilesSVG` global  |
| `maplibre-svg-export.js`         | `<script type="module">` and bundlers (ES module) |
| `maplibre-svg-export.d.ts`       | TypeScript declarations                           |
| `README.md`, `LICENSE`           |                                                   |

The latest one is always at `https://github.com/versatiles-org/versatiles-svg-renderer/releases/latest/download/maplibre-svg-export.tar.gz`.

## Options

```typescript
new SVGExportControl({
	defaultWidth: 1920, // default: the width of the map's container
	defaultHeight: 1080, // default: the height of the map's container
});
```

Both only set the starting values of the panel's size inputs; the user can change them.

## How the SVG is made

The preview and the export are rendered by [`renderToSVG`](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md) from the map's current style, centre, zoom, bearing and padding. Its notes on [labels](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#about-labels) and [projections](https://github.com/versatiles-org/versatiles-svg-renderer/blob/main/packages/svg-renderer/README.md#projections) apply here too.

Below the preview, the panel lists what the SVG leaves out: parts of the style the renderer does not draw, and the map's tilt, since the SVG is always flat.

## Bundle Composition

<!--- This chapter is generated automatically --->

[![Bundle composition](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/maplibre-svg-export/docs/bundle-treemap.svg)](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/maplibre-svg-export/docs/bundle-treemap.svg)

Sized by the bundle's own source map: **173.3 KB** raw, **46.4 KB** gzipped, across 88 modules.

## Dependency Graph

<!--- This chapter is generated automatically --->

[![Dependency graph](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/maplibre-svg-export/docs/dependency-graph.svg)](https://raw.githubusercontent.com/versatiles-org/versatiles-svg-renderer/main/packages/maplibre-svg-export/docs/dependency-graph.svg)

## License

MIT. Part of [VersaTiles](https://github.com/versatiles-org/versatiles-svg-renderer): source code, issues and the changelog are on GitHub.
