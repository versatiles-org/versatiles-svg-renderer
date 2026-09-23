/**
 * The parts of MapLibre GL JS that the control uses, declared locally.
 *
 * Importing them from `maplibre-gl` would put `import … from 'maplibre-gl'` into the
 * published `.d.ts`, so every TypeScript consumer would need maplibre-gl installed just to
 * typecheck, even a page that loads maplibre-gl from a `<script>` tag. The control never
 * touches maplibre-gl at runtime (it only calls methods on the map it is added to), so these
 * structural types are all it needs. `maplibre-types.test.ts` checks that MapLibre's own
 * `Map` and `IControl` still fit them.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

/** A map interaction handler, such as `map.dragPan`. */
export interface MapInteractionHandler {
	enable(): void;
	disable(): void;
}

/** The members of a MapLibre `Map` that {@link SVGExportControl} uses. */
export interface MapLibreMap {
	getContainer(): HTMLElement;
	getCenter(): { lng: number; lat: number };
	getZoom(): number;
	getBearing(): number;
	getPitch(): number;
	getStyle(): StyleSpecification;
	boxZoom: MapInteractionHandler;
	doubleClickZoom: MapInteractionHandler;
	dragPan: MapInteractionHandler;
	dragRotate: MapInteractionHandler;
	keyboard: MapInteractionHandler;
	scrollZoom: MapInteractionHandler;
	touchPitch: MapInteractionHandler;
	touchZoomRotate: MapInteractionHandler;
}

/** MapLibre's `IControl` interface, as far as {@link SVGExportControl} implements it. */
export interface MapLibreControl {
	onAdd(map: MapLibreMap): HTMLElement;
	onRemove(map: MapLibreMap): void;
}
