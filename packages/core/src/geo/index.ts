/** Features and their geometry, and the map projection that places them on screen. */
export {
	Feature,
	GEOJSON_LAYER,
	Point2D,
	VIEW_MARGIN,
	viewArea,
	type Features,
	type LayerFeatures,
	type SourceFeatures,
} from './geometry.js';
export {
	MAX_LATITUDE,
	mercatorToLonLat,
	Projection,
	type ClipCircle,
	type Padding,
	type RasterTriangle,
	type TileID,
} from './projection.js';
