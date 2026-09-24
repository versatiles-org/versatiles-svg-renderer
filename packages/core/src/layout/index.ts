/**
 * Where symbols and the pieces of lines go, and what shape they take: shared by the
 * pipeline, which lays features out, and every renderer, which draws them.
 */
export {
	JUSTIFY_ANCHOR,
	letterSpacingShift,
	mapTextAnchor,
	type TextAlign,
	type TextBaseline,
} from './anchors.js';
export { fitIconToText, iconQuads, quadsBox, type IconQuad } from './icon_quads.js';
export { linePatternStrips, patternPeriod, type PatternStrip } from './line_pattern.js';
export { chainSegments, offsetSegmentPoints, strokeLines, type Segment } from './segments.js';
