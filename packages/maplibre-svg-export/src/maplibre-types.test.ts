import { describe, expectTypeOf, test } from 'vitest';
import type { IControl, Map } from 'maplibre-gl';
import type { MapLibreMap } from './maplibre-types.js';
import type { SVGExportControl } from './control.js';

// Type-level only: `npm run typecheck` fails if MapLibre GL JS and the local declarations
// drift apart. maplibre-gl is a devDependency, so this is the only place it is imported.
describe('local MapLibre types', () => {
	test("MapLibre's Map provides everything the control uses", () => {
		expectTypeOf<Map>().toExtend<MapLibreMap>();
	});

	test('the control is a MapLibre IControl, so map.addControl() accepts it', () => {
		expectTypeOf<SVGExportControl>().toExtend<IControl>();
	});
});
