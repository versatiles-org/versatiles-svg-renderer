/**
 * The control's and the panel's CSS.
 *
 * The colours follow the map's colour scheme where the page signals one, with
 * `data-color-scheme="light"` or `"dark"` on the map's container, as maplibre-versatiles-styler
 * does. The colours of the shared variables `--maplibregl-ctrl-bg`, `-fg`, `-line` and `-hover`
 * win where a page sets them. Without the signal, or in a browser without `light-dark()`, the
 * control and the panel are light, as before.
 */
export const PANEL_CSS = `
.svg-export-control button.svg-export-btn {
	background: none;
	border: none;
	color: #333;
	cursor: pointer;
	padding: 5px;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 29px;
	height: 29px;
}

.svg-export-control button.svg-export-btn svg {
	width: 19px;
	height: 19px;
	fill: currentColor;
}

.svg-export-panel {
	--svg-export-bg: #fff;
	--svg-export-fg: #333;
	--svg-export-muted: #666;
	--svg-export-subtle: #888;
	--svg-export-faint: #999;
	--svg-export-line: #ddd;
	--svg-export-field-line: #ccc;
	--svg-export-sunken: #f9f9f9;
	--svg-export-hover: #f0f0f0;
	--svg-export-warn: #8a5a00;
	--svg-export-accent: #4264fb;
	--svg-export-accent-hover: #3352d9;
	--svg-export-accent-disabled: #a0b0e0;
	--svg-export-neutral: #555;
	--svg-export-neutral-hover: #444;
	--svg-export-neutral-disabled: #aaa;
	--svg-export-disabled-ink: #fff;
	--svg-export-shadow: 0 2px 12px rgba(0,0,0,0.25);

	position: absolute;
	top: 10px;
	right: 10px;
	background: var(--svg-export-bg);
	border-radius: 8px;
	box-shadow: var(--svg-export-shadow);
	padding: 16px;
	z-index: 1000;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 13px;
	color: var(--svg-export-fg);
	min-width: 320px;
	max-width: 90vw;
	max-height: 90vh;
	overflow: auto;
}

.svg-export-panel .panel-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 12px;
}

.svg-export-panel .panel-header h3 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.svg-export-panel .panel-close {
	background: none;
	border: none;
	cursor: pointer;
	font-size: 18px;
	color: var(--svg-export-muted);
	padding: 2px 6px;
	border-radius: 4px;
}

.svg-export-panel .panel-close:hover {
	background: var(--svg-export-hover);
}

.svg-export-panel .panel-inputs {
	margin-bottom: 12px;
}

.svg-export-panel .panel-inputs .grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	margin-bottom: 12px;
}

.svg-export-panel .panel-inputs label {
	font-size: 12px;
	color: var(--svg-export-muted);
}

.svg-export-panel .panel-inputs .grid label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	width: 100%;
}

.svg-export-panel .panel-inputs input {
	padding: 4px 8px;
	border: 1px solid var(--svg-export-field-line);
	border-radius: 4px;
	font-size: 13px;
	box-sizing: border-box;
}

.svg-export-panel .preview-container {
	border: 1px solid var(--svg-export-line);
	border-radius: 4px;
	overflow: hidden;
	margin-bottom: 12px;
	background: var(--svg-export-sunken);
	width: 320px;
	height: 240px;
	display: flex;
	align-items: center;
	justify-content: center;
}

.svg-export-panel .preview-container iframe {
	border: none;
	width: 100%;
	height: 100%;
	display: block;
	/* The preview's document is light: an iframe of another scheme would get an opaque backdrop. */
	color-scheme: light;
}

.svg-export-panel .preview-loading {
	color: var(--svg-export-faint);
	font-size: 13px;
}

.svg-export-panel .preview-warnings {
	font-size: 11px;
	color: var(--svg-export-warn);
	line-height: 1.4;
	margin: -4px 0 12px;
	padding-left: 16px;
	max-width: 304px;
	max-height: 96px;
	overflow-y: auto;
	overflow-wrap: anywhere;
}

.svg-export-panel .preview-warnings[hidden] {
	display: none;
}

.svg-export-panel .panel-notice {
	font-size: 11px;
	color: var(--svg-export-subtle);
	line-height: 1.4;
	margin-bottom: 12px;
	max-width: 320px;
}

.svg-export-panel .panel-notice a {
	color: inherit;
	text-decoration: underline;
}

.svg-export-panel .panel-notice a:hover {
	text-decoration: underline;
}

.svg-export-panel .panel-actions {
	display: flex;
	gap: 8px;
}

.svg-export-panel .panel-actions button {
	flex: 1;
	padding: 8px 12px;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 13px;
	font-weight: 500;
}

.svg-export-panel .btn-download {
	background: var(--svg-export-accent);
	color: #fff;
}

.svg-export-panel .btn-download:hover {
	background: var(--svg-export-accent-hover);
}

.svg-export-panel .btn-download:disabled {
	background: var(--svg-export-accent-disabled);
	color: var(--svg-export-disabled-ink);
	cursor: not-allowed;
}

.svg-export-panel .btn-open {
	background: var(--svg-export-neutral);
	color: #fff;
}

.svg-export-panel .btn-open:hover {
	background: var(--svg-export-neutral-hover);
}

.svg-export-panel .btn-open:disabled {
	background: var(--svg-export-neutral-disabled);
	color: var(--svg-export-disabled-ink);
	cursor: not-allowed;
}

/* Without light-dark(), the values below would be invalid, and the colours transparent. */
@supports (color: light-dark(#000, #fff)) {
	/* color-scheme on the control and the panel turns their form fields and scrollbars, and resolves
	   every light-dark() in them, including the page's variables. */
	.maplibregl-map[data-color-scheme='dark'] :is(.svg-export-control, .svg-export-panel) {
		color-scheme: dark;
	}

	/* Light on a light map, even on a dark page. */
	.maplibregl-map[data-color-scheme='light'] :is(.svg-export-control, .svg-export-panel) {
		color-scheme: light;
	}

	.maplibregl-map[data-color-scheme] .maplibregl-ctrl-group.svg-export-control {
		background: var(--maplibregl-ctrl-bg, light-dark(#fff, #161b22));
	}

	.maplibregl-map[data-color-scheme='dark'] .maplibregl-ctrl-group.svg-export-control {
		box-shadow: 0 0 0 2px rgb(255 255 255 / 12%);
	}

	.maplibregl-map[data-color-scheme] .svg-export-control button.svg-export-btn {
		color: var(--maplibregl-ctrl-fg, light-dark(#333, #e4e9ef));
	}

	@media (hover: hover) {
		.maplibregl-map[data-color-scheme] .svg-export-control button.svg-export-btn:hover {
			background-color: var(--maplibregl-ctrl-hover, light-dark(rgb(0 0 0 / 5%), rgb(255 255 255 / 8%)));
		}
	}

	.maplibregl-map[data-color-scheme] .svg-export-panel {
		--svg-export-bg: var(--maplibregl-ctrl-bg, light-dark(#fff, #161b22));
		--svg-export-fg: var(--maplibregl-ctrl-fg, light-dark(#333, #e4e9ef));
		--svg-export-line: var(--maplibregl-ctrl-line, light-dark(#ddd, #2a313b));
		--svg-export-hover: var(--maplibregl-ctrl-hover, light-dark(#f0f0f0, rgb(255 255 255 / 8%)));
		--svg-export-muted: light-dark(#666, #a2acb9);
		--svg-export-subtle: light-dark(#888, #8d97a4);
		--svg-export-faint: light-dark(#999, #8d97a4);
		--svg-export-field-line: light-dark(#ccc, #3a4350);
		--svg-export-sunken: light-dark(#f9f9f9, #0f1318);
		--svg-export-warn: light-dark(#8a5a00, #f0a44b);
		--svg-export-accent-hover: light-dark(#3352d9, #5577ff);
		--svg-export-accent-disabled: light-dark(#a0b0e0, #2c3a66);
		--svg-export-neutral: light-dark(#555, #3a4350);
		--svg-export-neutral-hover: light-dark(#444, #4a5462);
		--svg-export-neutral-disabled: light-dark(#aaa, #262d36);
		--svg-export-disabled-ink: light-dark(#fff, #8d97a4);
	}

	/* light-dark() takes colours only, not shadows. */
	.maplibregl-map[data-color-scheme='dark'] .svg-export-panel {
		--svg-export-shadow: 0 0 0 1px rgb(255 255 255 / 12%), 0 10px 28px rgba(0,0,0,0.5);
	}
}
`;
