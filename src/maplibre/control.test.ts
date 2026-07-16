// @vitest-environment jsdom

import { describe, expect, test, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../index.js', () => ({
	renderToSVG: vi.fn().mockResolvedValue('<svg>mock</svg>'),
}));

const { renderToSVG } = await import('../index.js');
const { SVGExportControl } = await import('./control.js');

function createMockHandler() {
	return { enable: vi.fn(), disable: vi.fn() };
}

function createMockMap(overrides?: Record<string, unknown>) {
	const container = document.createElement('div');
	return {
		getContainer: vi.fn(() => container),
		getCenter: vi.fn(() => ({ lng: 13.4, lat: 52.5 })),
		getZoom: vi.fn(() => 10),
		getStyle: vi.fn(() => ({
			version: 8,
			sources: {},
			layers: [],
		})),
		boxZoom: createMockHandler(),
		doubleClickZoom: createMockHandler(),
		dragPan: createMockHandler(),
		dragRotate: createMockHandler(),
		keyboard: createMockHandler(),
		scrollZoom: createMockHandler(),
		touchPitch: createMockHandler(),
		touchZoomRotate: createMockHandler(),
		...overrides,
	};
}

describe('SVGExportControl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	describe('constructor', () => {
		test('uses default options when none provided', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const container = map.getContainer();
			expect(container.querySelector<HTMLInputElement>('.input-width')!.value).toBe('1024');
			expect(container.querySelector<HTMLInputElement>('.input-height')!.value).toBe('1024');
		});

		test('accepts custom options', () => {
			const control = new SVGExportControl({
				defaultWidth: 800,
				defaultHeight: 600,
			});
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const container = map.getContainer();
			expect(container.querySelector<HTMLInputElement>('.input-width')!.value).toBe('800');
			expect(container.querySelector<HTMLInputElement>('.input-height')!.value).toBe('600');
		});

		test('defaults export size to the map viewport when no size option is given', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const container = map.getContainer();
			// Simulate a laid-out map viewport (jsdom reports 0 without this).
			Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true });
			Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });

			const el = control.onAdd(map as never);
			el.querySelector('button')!.click();

			expect(container.querySelector<HTMLInputElement>('.input-width')!.value).toBe('1200');
			expect(container.querySelector<HTMLInputElement>('.input-height')!.value).toBe('800');
		});

		test('explicit size options override the viewport size', () => {
			const control = new SVGExportControl({ defaultWidth: 640, defaultHeight: 480 });
			const map = createMockMap();
			const container = map.getContainer();
			Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true });
			Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });

			const el = control.onAdd(map as never);
			el.querySelector('button')!.click();

			expect(container.querySelector<HTMLInputElement>('.input-width')!.value).toBe('640');
			expect(container.querySelector<HTMLInputElement>('.input-height')!.value).toBe('480');
		});
	});

	describe('onAdd', () => {
		test('returns a container element', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			expect(el).toBeInstanceOf(HTMLElement);
			expect(el.classList.contains('maplibregl-ctrl')).toBe(true);
			expect(el.classList.contains('maplibregl-ctrl-group')).toBe(true);
			expect(el.classList.contains('svg-export-control')).toBe(true);
		});

		test('adds a style element to the head', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			control.onAdd(map as never);

			const styleEl = document.head.querySelector('style');
			expect(styleEl).toBeTruthy();
			expect(styleEl!.textContent).toContain('.svg-export-panel');
		});

		test('creates a button with SVG icon', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			const button = el.querySelector('button');
			expect(button).toBeTruthy();
			expect(button!.type).toBe('button');
			expect(button!.className).toBe('svg-export-btn');
			expect(button!.title).toBe('Export SVG');
			expect(button!.innerHTML).toContain('<svg');
		});
	});

	describe('onRemove', () => {
		test('cleans up container and style', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);
			document.body.appendChild(el);

			expect(document.head.querySelector('style')).toBeTruthy();
			expect(document.body.contains(el)).toBe(true);

			control.onRemove();

			expect(document.head.querySelector('style')).toBeFalsy();
			expect(document.body.contains(el)).toBe(false);
		});
	});

	describe('panel lifecycle', () => {
		test('opens panel on button click', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const panel = map.getContainer().querySelector('.svg-export-panel');
			expect(panel).toBeTruthy();
		});

		test('panel contains all expected elements', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const container = map.getContainer();
			expect(container.querySelector('.panel-header h3')!.textContent).toBe('Export SVG');
			expect(container.querySelector('.panel-close')).toBeTruthy();
			expect(container.querySelector('.input-width')).toBeTruthy();
			expect(container.querySelector('.input-height')).toBeTruthy();
			expect(container.querySelector('.preview-container')).toBeTruthy();
			expect(container.querySelector('.btn-download')).toBeTruthy();
			expect(container.querySelector('.btn-open')).toBeTruthy();
		});

		test('panel inputs have default values', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const container = map.getContainer();
			expect(container.querySelector<HTMLInputElement>('.input-width')!.value).toBe('1024');
			expect(container.querySelector<HTMLInputElement>('.input-height')!.value).toBe('1024');
		});

		test('buttons are initially disabled', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const container = map.getContainer();
			expect(container.querySelector<HTMLButtonElement>('.btn-download')!.disabled).toBe(true);
			expect(container.querySelector<HTMLButtonElement>('.btn-open')!.disabled).toBe(true);
		});

		test('close button removes panel', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const container = map.getContainer();
			expect(container.querySelector('.svg-export-panel')).toBeTruthy();

			container.querySelector<HTMLButtonElement>('.panel-close')!.click();
			expect(container.querySelector('.svg-export-panel')).toBeFalsy();
		});

		test('does not open a second panel if one is already open', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();
			el.querySelector('button')!.click();

			const panels = map.getContainer().querySelectorAll('.svg-export-panel');
			expect(panels.length).toBe(1);
		});
	});

	describe('map interactions', () => {
		test('disables map interactions when panel opens', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			expect(map.boxZoom.disable).toHaveBeenCalled();
			expect(map.doubleClickZoom.disable).toHaveBeenCalled();
			expect(map.dragPan.disable).toHaveBeenCalled();
			expect(map.dragRotate.disable).toHaveBeenCalled();
			expect(map.keyboard.disable).toHaveBeenCalled();
			expect(map.scrollZoom.disable).toHaveBeenCalled();
			expect(map.touchPitch.disable).toHaveBeenCalled();
			expect(map.touchZoomRotate.disable).toHaveBeenCalled();
		});

		test('re-enables map interactions when panel closes', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();
			map.getContainer().querySelector<HTMLButtonElement>('.panel-close')!.click();

			expect(map.boxZoom.enable).toHaveBeenCalled();
			expect(map.doubleClickZoom.enable).toHaveBeenCalled();
			expect(map.dragPan.enable).toHaveBeenCalled();
			expect(map.dragRotate.enable).toHaveBeenCalled();
			expect(map.keyboard.enable).toHaveBeenCalled();
			expect(map.scrollZoom.enable).toHaveBeenCalled();
			expect(map.touchPitch.enable).toHaveBeenCalled();
			expect(map.touchZoomRotate.enable).toHaveBeenCalled();
		});

		test('re-enables map interactions on onRemove', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();
			control.onRemove();

			expect(map.boxZoom.enable).toHaveBeenCalled();
		});
	});

	describe('updatePreview', () => {
		test('calls renderToSVG with map parameters', async () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				expect(renderToSVG).toHaveBeenCalled();
			});

			const call = vi.mocked(renderToSVG).mock.calls[0]![0];
			expect(call).toMatchObject({
				width: 1024,
				height: 1024,
				lon: 13.4,
				lat: 52.5,
				zoom: 10,
			});
		});

		test('enables buttons after successful render', async () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				const container = map.getContainer();
				expect(container.querySelector<HTMLButtonElement>('.btn-download')!.disabled).toBe(false);
			});

			const container = map.getContainer();
			expect(container.querySelector<HTMLButtonElement>('.btn-open')!.disabled).toBe(false);
		});

		test('creates iframe with SVG preview', async () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				const container = map.getContainer();
				expect(container.querySelector('.preview-container iframe')).toBeTruthy();
			});

			const iframe = map
				.getContainer()
				.querySelector<HTMLIFrameElement>('.preview-container iframe')!;
			expect(iframe.srcdoc).toContain('<svg>mock</svg>');
		});

		test('shows error message on render failure', async () => {
			(renderToSVG as Mock).mockRejectedValueOnce(new Error('render failed'));

			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				const container = map.getContainer();
				const errorSpan = container.querySelector('.preview-loading');
				expect(errorSpan?.textContent).toContain('Error: render failed');
			});
		});

		test('shows error for non-Error exceptions', async () => {
			(renderToSVG as Mock).mockRejectedValueOnce('string error');

			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				const container = map.getContainer();
				const errorSpan = container.querySelector('.preview-loading');
				expect(errorSpan?.textContent).toContain('Unknown error');
			});
		});

		test('shows invalid input message for bad values', async () => {
			const control = new SVGExportControl({
				defaultWidth: 0,
				defaultHeight: 1024,
			});
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			// Give it a tick to process
			await new Promise((r) => setTimeout(r, 0));

			const container = map.getContainer();
			const loading = container.querySelector('.preview-loading');
			expect(loading?.textContent).toBe('Invalid input values');
		});
	});

	describe('downloadSVG', () => {
		test('triggers download after render', async () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				expect(map.getContainer().querySelector<HTMLButtonElement>('.btn-download')!.disabled).toBe(
					false,
				);
			});

			const mockUrl = 'blob:mock-url';
			const createObjectURL = vi.fn(() => mockUrl);
			const revokeObjectURL = vi.fn();
			globalThis.URL.createObjectURL = createObjectURL;
			globalThis.URL.revokeObjectURL = revokeObjectURL;

			map.getContainer().querySelector<HTMLButtonElement>('.btn-download')!.click();

			expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
			expect(revokeObjectURL).toHaveBeenCalledWith(mockUrl);
		});

		test('does nothing if no SVG is available', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const createObjectURL = vi.fn();
			globalThis.URL.createObjectURL = createObjectURL;

			map.getContainer().querySelector<HTMLButtonElement>('.btn-download')!.click();

			expect(createObjectURL).not.toHaveBeenCalled();
		});
	});

	describe('openSVGInTab', () => {
		test('opens blob URL in new tab', async () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			await vi.waitFor(() => {
				expect(map.getContainer().querySelector<HTMLButtonElement>('.btn-open')!.disabled).toBe(
					false,
				);
			});

			const mockUrl = 'blob:mock-url';
			globalThis.URL.createObjectURL = vi.fn(() => mockUrl);
			globalThis.URL.revokeObjectURL = vi.fn();
			const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

			map.getContainer().querySelector<HTMLButtonElement>('.btn-open')!.click();

			expect(windowOpen).toHaveBeenCalledWith(mockUrl, '_blank');
		});
	});

	describe('attribution', () => {
		test('shows attribution from map sources', () => {
			const control = new SVGExportControl();
			const map = createMockMap({
				getStyle: vi.fn(() => ({
					version: 8,
					sources: {
						tiles: { type: 'vector', attribution: '&copy; OpenStreetMap' },
					},
					layers: [],
				})),
			});
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			expect(notice?.textContent).toContain("don't forget to add an attribution");
			expect(notice?.textContent).toContain('OpenStreetMap');
		});

		test('shows generic attribution notice when no sources have attribution', () => {
			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			expect(notice?.textContent).toContain('please check the license terms');
		});

		test('deduplicates attributions', () => {
			const control = new SVGExportControl();
			const map = createMockMap({
				getStyle: vi.fn(() => ({
					version: 8,
					sources: {
						src1: { type: 'vector', attribution: 'Same Attribution' },
						src2: { type: 'raster', attribution: 'Same Attribution' },
					},
					layers: [],
				})),
			});
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			const text = notice?.textContent ?? '';
			const count = text.split('Same Attribution').length - 1;
			expect(count).toBe(1);
		});

		test('sanitizes attribution HTML - strips disallowed tags', () => {
			const control = new SVGExportControl();
			const map = createMockMap({
				getStyle: vi.fn(() => ({
					version: 8,
					sources: {
						s: { type: 'vector', attribution: '<script>alert("xss")</script>Safe text' },
					},
					layers: [],
				})),
			});
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			expect(notice?.textContent).toContain('Safe text');
			expect(notice?.innerHTML).not.toContain('<script');
		});

		test('sanitizes attribution HTML - preserves allowed tags', () => {
			const control = new SVGExportControl();
			const map = createMockMap({
				getStyle: vi.fn(() => ({
					version: 8,
					sources: {
						s: { type: 'vector', attribution: '<b>Bold</b> and <em>emphasis</em>' },
					},
					layers: [],
				})),
			});
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			const text = notice?.textContent ?? '';
			expect(text).toContain('Bold');
			expect(text).toContain('emphasis');
			// Allowed tags are preserved, not flattened to plain text.
			const html = notice?.innerHTML ?? '';
			expect(html).toContain('<b>Bold</b>');
			expect(html).toContain('<em>emphasis</em>');
		});

		test('sanitizes attribution HTML - handles anchor tags with https', () => {
			const control = new SVGExportControl();
			const map = createMockMap({
				getStyle: vi.fn(() => ({
					version: 8,
					sources: {
						s: {
							type: 'vector',
							attribution: '<a href="https://example.com">Link</a>',
						},
					},
					layers: [],
				})),
			});
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			const text = notice?.textContent ?? '';
			expect(text).toContain('Link');
			// The link is preserved with its href and hardened with target/rel.
			const anchor = notice?.querySelector('a');
			expect(anchor?.getAttribute('href')).toBe('https://example.com');
			expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
			expect(anchor?.getAttribute('target')).toBe('_blank');
		});

		test('sanitizes attribution HTML - strips javascript: urls', () => {
			const control = new SVGExportControl();
			const map = createMockMap({
				getStyle: vi.fn(() => ({
					version: 8,
					sources: {
						s: {
							type: 'vector',
							attribution: '<a href="javascript:alert(1)">Evil</a>',
						},
					},
					layers: [],
				})),
			});
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			const notice = map.getContainer().querySelector('.panel-attribution');
			const text = notice?.textContent ?? '';
			expect(text).toContain('Evil');
			expect(notice?.innerHTML).not.toContain('javascript:');
		});
	});

	describe('debounced preview', () => {
		test('input change triggers debounced preview update', async () => {
			vi.useFakeTimers();
			(renderToSVG as Mock).mockResolvedValue('<svg>updated</svg>');

			const control = new SVGExportControl();
			const map = createMockMap();
			const el = control.onAdd(map as never);

			el.querySelector('button')!.click();

			// Wait for initial render
			await vi.runAllTimersAsync();

			(renderToSVG as Mock).mockClear();

			// Trigger input change
			const widthInput = map.getContainer().querySelector<HTMLInputElement>('.input-width')!;
			widthInput.value = '512';
			widthInput.dispatchEvent(new Event('input'));

			// Not called yet (debounce)
			expect(renderToSVG).not.toHaveBeenCalled();

			// Advance past debounce timer
			await vi.advanceTimersByTimeAsync(500);

			expect(renderToSVG).toHaveBeenCalled();

			vi.useRealTimers();
		});
	});
});
