import { inlineSources, osm } from '@versatiles/style';
import { renderToSVG } from './index.js';
import { writeFileSync } from 'node:fs';

const style = await inlineSources(osm({ theme: 'colorful' }));

const svgString = await renderToSVG({
	width: 512,
	height: 384,
	style,
	lon: 13.408333,
	lat: 52.518611,
	zoom: 10,
});

writeFileSync(new URL('../docs/demo.svg', import.meta.url).pathname, svgString);
