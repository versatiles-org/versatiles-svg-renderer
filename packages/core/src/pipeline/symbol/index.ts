/** Laying out labels and icons, and placing them without overlap. */
export {
	CollisionIndex,
	glyphBox,
	iconBox,
	layoutText,
	overlapMode,
	paddedBox,
	placeSymbols,
	type Box,
	type CollisionOptions,
	type OverlapMode,
	type PlacedSymbol,
	type TextLayout,
} from './collision.js';
export { traceGlyph, traceHalo } from './glyph_outline.js';
export { labelAnchors } from './label_anchors.js';
export {
	fitsMaxAngle,
	layoutAlongLine,
	layoutVertically,
	lineAnchors,
	measureLine,
	pointAt,
	runsVertically,
} from './line_labels.js';
export {
	breakLines,
	glyphAdvances,
	glyphMetrics,
	tableMetrics,
	type FontMetrics,
} from './text_metrics.js';
export {
	allowsLetterSpacing,
	drawnByFontEngine,
	drawnCharacters,
	labelLines,
	singleLine,
	type LabelLine,
} from './script.js';
export { anchorOffsets, radialOffset } from './variable_anchor.js';
export {
	allowsVerticalWritingMode,
	layoutVerticalText,
	verticalText,
	withVerticalPunctuation,
	type VerticalLayout,
	type VerticalText,
} from './vertical.js';
