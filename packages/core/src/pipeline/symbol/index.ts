/** Laying out labels and icons, and placing them without overlap. */
export {
	CollisionIndex,
	glyphBox,
	iconBox,
	layoutText,
	paddedBox,
	placeSymbols,
	type Box,
	type CollisionOptions,
	type PlacedSymbol,
} from './collision.js';
export { traceGlyph } from './glyph_outline.js';
export { labelAnchors } from './label_anchors.js';
export { fitsMaxAngle, layoutAlongLine, lineAnchors, measureLine, pointAt } from './line_labels.js';
export {
	breakLines,
	glyphAdvances,
	glyphMetrics,
	tableMetrics,
	type FontMetrics,
} from './text_metrics.js';
export { anchorOffsets, radialOffset } from './variable_anchor.js';
