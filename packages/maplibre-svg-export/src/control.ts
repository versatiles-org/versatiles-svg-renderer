import type { MapLibreControl, MapLibreMap } from './maplibre-types.js';
import { PANEL_CSS } from './panel_css.js';
import { renderToSVG } from '@versatiles/renderer-core/render_svg';

/** Options for {@link SVGExportControl}. */
export interface SVGExportControlOptions {
	/**
	 * Width, in pixels, that the export panel starts with. The user can change it.
	 * @defaultValue the width of the map's container (or `1024` if that reports zero)
	 */
	defaultWidth?: number;
	/**
	 * Height, in pixels, that the export panel starts with. The user can change it.
	 * @defaultValue the height of the map's container (or `1024` if that reports zero)
	 */
	defaultHeight?: number;
}

function querySelector(parent: Element, selector: string): HTMLElement {
	const el = parent.querySelector(selector);
	if (!(el instanceof HTMLElement)) throw new Error(`Element not found: ${selector}`);
	return el;
}

/** Shows `warnings` as the items of `list`, as text; hides the list when there are none. */
function showWarnings(list: HTMLElement, warnings: string[]): void {
	list.replaceChildren(
		...warnings.map((warning) => {
			const item = document.createElement('li');
			item.textContent = warning;
			return item;
		}),
	);
	list.hidden = warnings.length === 0;
}

const ALLOWED_TAGS = new Set(['a', 'b', 'i', 'em', 'strong', 'span']);

function sanitizeHTML(html: string): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	// Serialize the sanitized tree back to HTML so allowed tags and safe links
	// survive. The result is later assigned via innerHTML; every text node is
	// re-escaped by the serializer, so it is safe to concatenate and inject.
	const container = document.createElement('div');
	container.append(sanitizeNode(doc.body));
	return container.innerHTML;
}

function sanitizeNode(node: Node): Node {
	if (node.nodeType === Node.TEXT_NODE) {
		return document.createTextNode(node.textContent ?? '');
	}
	if (node.nodeType === Node.ELEMENT_NODE && node instanceof HTMLElement) {
		const tag = node.tagName.toLowerCase();
		let span: HTMLElement | DocumentFragment;
		if (!ALLOWED_TAGS.has(tag)) {
			span = document.createDocumentFragment();
		} else {
			span = document.createElement(tag);
			if (tag === 'a') {
				const href = node.getAttribute('href');
				if (href && /^https?:\/\//i.test(href)) span.setAttribute('href', href);
				span.setAttribute('target', '_blank');
				span.setAttribute('rel', 'noopener noreferrer');
			}
		}
		for (const child of Array.from(node.childNodes)) {
			span.append(sanitizeNode(child));
		}
		return span;
	}
	return document.createTextNode('');
}

/**
 * A MapLibre GL JS control that exports the current map view as an SVG image.
 *
 * Adds a button to the map. Clicking it opens a panel with a live preview of the view as
 * SVG, where the user can set the image size, choose whether to include labels and icons,
 * and then download the file or open it in a new tab. The map stops responding to
 * panning and zooming while the panel is open, so the preview matches what is exported.
 *
 * The preview is rendered with {@link renderToSVG} from the map's current style, centre
 * and zoom, and the panel shows the attribution of the style's sources.
 *
 * @example With a bundler
 * ```ts
 * import maplibregl from 'maplibre-gl';
 * import { SVGExportControl } from '@versatiles/maplibre-svg-export';
 *
 * const map = new maplibregl.Map({
 *   container: 'map',
 *   style: 'https://tiles.versatiles.org/assets/styles/colorful/style.json',
 *   center: [13.4, 52.52],
 *   zoom: 10,
 * });
 *
 * map.addControl(new SVGExportControl(), 'top-right');
 * ```
 *
 * @example With a script tag
 * The UMD bundle, served by jsDelivr, exposes everything on a global `VersaTilesSVG`:
 * ```html
 * <script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
 * <script src="https://cdn.jsdelivr.net/npm/@versatiles/maplibre-svg-export@2"></script>
 * <script>
 *   const map = new maplibregl.Map({ container: 'map', style: '…', center: [13.4, 52.52], zoom: 10 });
 *   map.addControl(new VersaTilesSVG.SVGExportControl(), 'top-right');
 * </script>
 * ```
 *
 * @example Start the panel at a fixed size
 * ```ts
 * map.addControl(new SVGExportControl({ defaultWidth: 1920, defaultHeight: 1080 }));
 * ```
 */
export class SVGExportControl implements MapLibreControl {
	private map: MapLibreMap | undefined;
	private container: HTMLDivElement | undefined;
	private styleEl: HTMLStyleElement | undefined;
	private panel: HTMLDivElement | undefined;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private currentSVG: string | undefined;
	private renderGeneration = 0;
	private options: SVGExportControlOptions;

	/** @param options - The panel's initial image size. Both default to the map's size. */
	constructor(options?: SVGExportControlOptions) {
		this.options = { ...options };
	}

	/**
	 * Called by MapLibre when the control is added with `map.addControl()`; not meant to be
	 * called directly. Returns the button to place on the map.
	 */
	onAdd(map: MapLibreMap): HTMLElement {
		this.map = map;

		this.styleEl = document.createElement('style');
		this.styleEl.textContent = PANEL_CSS;
		document.head.appendChild(this.styleEl);

		this.container = document.createElement('div');
		this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group svg-export-control';

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'svg-export-btn';
		button.title = 'Export SVG';
		button.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
		button.addEventListener('click', () => {
			this.openPanel();
		});

		this.container.appendChild(button);
		return this.container;
	}

	/**
	 * Called by MapLibre when the control is removed with `map.removeControl()`; not meant
	 * to be called directly. Closes the panel and cleans up.
	 */
	onRemove(): void {
		this.closePanel();
		this.container?.remove();
		this.styleEl?.remove();
		this.map = undefined;
	}

	private openPanel(): void {
		if (this.panel || !this.map) return;

		const mapContainer = this.map.getContainer();

		// Seed the size inputs from the current map viewport so the default export
		// matches what the user sees on screen. Explicit constructor options win;
		// the 1024 fallback covers environments that report no layout size
		// (clientWidth 0). Inputs stay independent — the user can change either.
		const defaultWidth = this.options.defaultWidth ?? (mapContainer.clientWidth || 1024);
		const defaultHeight = this.options.defaultHeight ?? (mapContainer.clientHeight || 1024);

		this.panel = document.createElement('div');
		this.panel.className = 'svg-export-panel';

		this.panel.innerHTML = `
			<div class="panel-header">
				<h3>Export SVG</h3>
				<button class="panel-close" title="Close">\u00d7</button>
			</div>
			<div class="panel-notice">
				Note:<br>
				<span class="panel-attribution"></span><br>
				Text labels are rendered without collision detection, so labels may overlap. You can improve me on <a href="https://github.com/versatiles-org/versatiles-svg-renderer" target="_blank" rel="noopener noreferrer">GitHub</a>.<br>
			</div>
			<div class="panel-inputs">
				<div class="grid">
					<label>Width<input type="number" class="input-width" value="${String(defaultWidth)}" min="1" max="8192"></label>
					<label>Height<input type="number" class="input-height" value="${String(defaultHeight)}" min="1" max="8192"></label>
				</div>
				<label class="label-checkbox"><input type="checkbox" class="input-labels"> Include labels and icons (buggy)</label>
			</div>
			<div class="preview-container">
				<span class="preview-loading">Rendering preview\u2026</span>
			</div>
			<ul class="preview-warnings" hidden></ul>
			<div class="panel-actions">
				<button class="btn-download" disabled>Download</button>
				<button class="btn-open" disabled>Open in Tab</button>
			</div>
		`;

		const noticeEl = querySelector(this.panel, '.panel-attribution');
		const sources = this.map.getStyle().sources;
		const attributions = [
			...new Set(
				Object.values(sources)
					.map((s) => (s as { attribution?: string }).attribution?.trim())
					.filter((a): a is string => !!a),
			),
		];
		if (attributions.length > 0) {
			noticeEl.innerHTML =
				"When publishing the exported map, don't forget to add an attribution like: " +
				attributions.map(sanitizeHTML).join(', ');
		} else {
			noticeEl.textContent =
				'When publishing the exported map, please check the license terms of the data and include proper attribution.';
		}

		querySelector(this.panel, '.panel-close').addEventListener('click', () => {
			this.closePanel();
		});

		this.panel.querySelectorAll('input').forEach((input) => {
			input.addEventListener('input', () => {
				this.schedulePreview();
			});
			input.addEventListener('change', () => {
				this.schedulePreview();
			});
		});

		querySelector(this.panel, '.btn-download').addEventListener('click', () => {
			this.downloadSVG();
		});

		querySelector(this.panel, '.btn-open').addEventListener('click', () => {
			this.openSVGInTab();
		});

		mapContainer.appendChild(this.panel);
		this.setMapInteractions(false);
		void this.updatePreview();
	}

	private closePanel(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}
		this.renderGeneration++;
		this.panel?.remove();
		this.panel = undefined;
		this.currentSVG = undefined;
		this.setMapInteractions(true);
	}

	private setMapInteractions(enabled: boolean): void {
		if (!this.map) return;
		const handlers = [
			this.map.boxZoom,
			this.map.doubleClickZoom,
			this.map.dragPan,
			this.map.dragRotate,
			this.map.keyboard,
			this.map.scrollZoom,
			this.map.touchPitch,
			this.map.touchZoomRotate,
		];
		for (const handler of handlers) {
			if (enabled) {
				handler.enable();
			} else {
				handler.disable();
			}
		}
	}

	private schedulePreview(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			void this.updatePreview();
		}, 500);
	}

	private async updatePreview(): Promise<void> {
		if (!this.panel || !this.map) return;

		const generation = this.renderGeneration;
		const panel = this.panel;
		const map = this.map;

		const previewContainer = querySelector(panel, '.preview-container');
		const warningList = querySelector(panel, '.preview-warnings');
		showWarnings(warningList, []);
		const downloadBtn = querySelector(panel, '.btn-download') as HTMLButtonElement;
		const openBtn = querySelector(panel, '.btn-open') as HTMLButtonElement;

		previewContainer.innerHTML = '<span class="preview-loading">Rendering preview\u2026</span>';
		downloadBtn.disabled = true;
		openBtn.disabled = true;

		const width = Number((querySelector(panel, '.input-width') as HTMLInputElement).value);
		const height = Number((querySelector(panel, '.input-height') as HTMLInputElement).value);
		const renderLabels = (querySelector(panel, '.input-labels') as HTMLInputElement).checked;

		if (!width || !height || width < 1 || height < 1) {
			previewContainer.innerHTML = '<span class="preview-loading">Invalid input values</span>';
			return;
		}

		const warnings: string[] = [];
		// The renderer draws a flat, north-up map only (a fraction of a degree is not visible).
		if (Math.abs(map.getBearing()) >= 0.1) {
			warnings.push('The map is rotated: the SVG is exported north-up.');
		}
		if (map.getPitch() >= 0.1) {
			warnings.push('The map is tilted: the SVG is exported as a flat, top-down view.');
		}

		try {
			const center = map.getCenter();
			const zoom = map.getZoom();
			const style = map.getStyle();

			const svg = await renderToSVG({
				width,
				height,
				style,
				lon: center.lng,
				lat: center.lat,
				zoom,
				renderLabels,
				onWarning: (message) => warnings.push(message),
			});

			if (this.renderGeneration !== generation) return;
			showWarnings(warningList, warnings);

			this.currentSVG = svg;

			const iframe = document.createElement('iframe');
			iframe.srcdoc = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;overflow:hidden;}body{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;}svg{max-width:100%;max-height:100%;width:auto;height:auto;display:block;}</style></head><body>${svg}</body></html>`;
			previewContainer.innerHTML = '';
			previewContainer.appendChild(iframe);
			downloadBtn.disabled = false;
			openBtn.disabled = false;
		} catch (error: unknown) {
			if (this.renderGeneration !== generation) return;
			showWarnings(warningList, warnings);
			const message = error instanceof Error ? error.message : 'Unknown error';
			const errorSpan = document.createElement('span');
			errorSpan.className = 'preview-loading';
			errorSpan.textContent = `Error: ${message}`;
			previewContainer.innerHTML = '';
			previewContainer.appendChild(errorSpan);
		}
	}

	private downloadSVG(): void {
		if (!this.currentSVG) return;

		const blob = new Blob([this.currentSVG], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'map-export.svg';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	private openSVGInTab(): void {
		if (!this.currentSVG) return;

		const blob = new Blob([this.currentSVG], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(blob);
		window.open(url, '_blank');
		setTimeout(() => URL.revokeObjectURL(url), 60000);
	}
}
