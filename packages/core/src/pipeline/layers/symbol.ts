import type { Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { Feature as LayerFeature, Point2D } from '../../geo/index.js';
import type {
	GlyphOutline,
	GlyphPlacement,
	IconStyle,
	PlacedGlyph,
	RenderJob,
	SymbolStyle,
} from '../../types.js';
import { fitIconToText, iconQuads, quadsBox, TEXT_BASELINE } from '../../layout/index.js';
import { type Glyph, GLYPH_EM, type GlyphRange, rangeStart } from '../../sources/index.js';
import type { StyleLayer } from '../style_layer.js';
import {
	allowsLetterSpacing,
	allowsVerticalWritingMode,
	anchorOffsets,
	CollisionIndex,
	drawnByFontEngine,
	drawnCharacters,
	fitsMaxAngle,
	glyphAdvances,
	glyphBox,
	glyphMetrics,
	iconBox,
	labelAnchors,
	labelLines,
	layoutAlongLine,
	layoutText,
	layoutVertically,
	layoutVerticalText,
	lineAnchors,
	measureLine,
	overlapMode,
	paddedBox,
	placeSymbols,
	pointAt,
	radialOffset,
	runsVertically,
	singleLine,
	tableMetrics,
	traceGlyph,
	verticalText,
	withVerticalPunctuation,
	type Box,
	type CollisionOptions,
	type FontMetrics,
	type PlacedSymbol,
	type LabelLine,
	type TextLayout,
	type VerticalLayout,
	type VerticalText,
} from '../symbol/index.js';
import {
	evaluateLayer,
	filterFeatures,
	getFeatures,
	screenTranslate,
	sortByKey,
	type Layer,
} from './layer.js';

function resolveTokens(text: string, properties: Record<string, unknown>): string {
	return text.replace(/\{([^}]+)\}/g, (_, key: string) => {
		const value = properties[key];
		if (value == null) return '';
		if (typeof value === 'string') return value;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		return '';
	});
}

/** Applies `text-transform`, with the locale-aware case mapping MapLibre uses. */
export function transformText(text: string, transform: unknown): string {
	if (transform === 'uppercase') return text.toLocaleUpperCase();
	if (transform === 'lowercase') return text.toLocaleLowerCase();
	return text;
}

/** A label, an icon or both at one point, and whether collision detection keeps them. */
interface SymbolEntry extends PlacedSymbol {
	icon?: [LayerFeature, IconStyle];
	label?: [LayerFeature, SymbolStyle];
	/** The label, and the icon if fitted to it, at each place to try (see `PlacedSymbol`). */
	anchors?: (NonNullable<PlacedSymbol['anchors']>[number] & {
		label?: [LayerFeature, SymbolStyle];
		icon?: [LayerFeature, IconStyle];
	})[];
}

/**
 * The symbols of every visible symbol layer, placed from the top layer down, as in
 * MapLibre: a symbol of a higher layer wins over one below that it would overlap. Empty
 * when labels are not rendered.
 */
export async function placeSymbolLayers(
	job: RenderJob,
	layers: StyleLayer[],
	makeLayer: (layerStyle: StyleLayer) => Layer,
): Promise<Map<StyleLayer, SymbolEntry[]>> {
	const symbols = new Map<StyleLayer, SymbolEntry[]>();
	if ((job.labels ?? 'none') === 'none') return symbols;
	const index = new CollisionIndex(job.renderer.width, job.renderer.height);
	for (const layerStyle of [...layers].reverse()) {
		if (layerStyle.type !== 'symbol' || layerStyle.isHidden(job.view.zoom)) continue;
		const entries = await prepareSymbolLayer(makeLayer(layerStyle));
		placeSymbols(entries, index);
		symbols.set(layerStyle, entries);
	}
	return symbols;
}

/**
 * The symbols of a layer, in the order they are placed and drawn: each feature's label
 * and icon at each point it is placed at, with their collision boxes.
 */
async function prepareSymbolLayer(layer: Layer): Promise<SymbolEntry[]> {
	const { job, context, layerStyle, spriteAtlas } = layer;
	const features = getFeatures(layer.sourceFeatures, layerStyle);
	const allFeatures = [
		...(features?.points ?? []),
		...(features?.linestrings ?? []),
		...(features?.polygons ?? []),
	];
	if (allFeatures.length === 0) return [];
	const filtered = filterFeatures(layer, allFeatures);
	if (filtered.length === 0) return [];

	const { getPaint, getLayout } = evaluateLayer(layer);
	const symbolFeatures = sortByKey(filtered, (feature) => getLayout('symbol-sort-key', feature));
	const labelText = (feature: LayerFeature): string => {
		const textField = getLayout('text-field', feature);
		const textRaw = textField != null ? (textField as { toString(): string }).toString() : '';
		return transformText(
			resolveTokens(textRaw, feature.properties),
			getLayout('text-transform', feature),
		);
	};

	// Drawn as glyphs, labels need the style's glyphs before they are laid out, with their
	// metrics: all ranges the layer's labels use (Arabic in its shapes), loaded together; not
	// those of labels drawn as text anyway, as MapLibre draws them with the browser's fonts.
	const glyphMode = job.labels === 'glyphs' || job.labels === 'glyphs-text';
	const glyphRanges = new Map<string, GlyphRange | undefined>();
	if (glyphMode) {
		const wanted = new Set<string>();
		for (const feature of symbolFeatures) {
			const fontStack = (getLayout('text-font', feature) as string[]).join(',');
			const text = labelText(feature);
			if (drawnByFontEngine(text)) continue;
			for (const char of drawnCharacters(text)) {
				wanted.add(`${fontStack}\0${String(rangeStart(char.codePointAt(0)!))}`);
			}
		}
		await Promise.all(
			[...wanted].map(async (key) => {
				const [fontStack, start] = key.split('\0') as [string, string];
				glyphRanges.set(key, await context.getGlyphRange(fontStack, Number(start)));
			}),
		);
	}

	// `text-radial-offset`, if the style sets one, takes the place of `text-offset`.
	const radial = (feature: LayerFeature): number | undefined =>
		layerStyle.setsLayout('text-radial-offset')
			? (getLayout('text-radial-offset', feature) as number)
			: undefined;
	const textOffset = (feature: LayerFeature): [number, number] => {
		const radius = radial(feature);
		return radius
			? radialOffset(getLayout('text-anchor', feature) as string, radius)
			: (getLayout('text-offset', feature) as [number, number]);
	};

	const entries: SymbolEntry[] = [];
	for (const feature of symbolFeatures) {
		// Styles are evaluated for the feature itself (`geometry-type` must see a polygon as
		// a polygon); only then is each symbol moved to the points it is placed at.
		const iconImage = getLayout('icon-image', feature);
		const iconName =
			iconImage != null
				? resolveTokens((iconImage as { toString(): string }).toString(), feature.properties)
				: '';
		const sprite = iconName ? spriteAtlas.get(iconName) : undefined;
		const iconStyle: IconStyle | undefined = sprite && {
			image: iconName,
			size: getLayout('icon-size', feature) as number,
			anchor: getLayout('icon-anchor', feature) as string,
			offset: getLayout('icon-offset', feature) as [number, number],
			rotate: getLayout('icon-rotate', feature) as number,
			opacity: getPaint('icon-opacity', feature) as number,
			sdf: sprite.sdf,
			color: getPaint('icon-color', feature) as MaplibreColor,
			haloColor: getPaint('icon-halo-color', feature) as MaplibreColor,
			haloWidth: getPaint('icon-halo-width', feature) as number,
		};

		const text = labelText(feature);
		const labelStyle: SymbolStyle | undefined = text
			? {
					text,
					size: getLayout('text-size', feature) as number,
					font: getLayout('text-font', feature) as string[],
					anchor: getLayout('text-anchor', feature) as string,
					offset: textOffset(feature),
					rotate: getLayout('text-rotate', feature) as number,
					color: getPaint('text-color', feature) as MaplibreColor,
					opacity: getPaint('text-opacity', feature) as number,
					haloColor: getPaint('text-halo-color', feature) as MaplibreColor,
					haloWidth: getPaint('text-halo-width', feature) as number,
					// As in MapLibre, letters of a cursive script are not spaced apart.
					letterSpacing: allowsLetterSpacing(text)
						? (getLayout('text-letter-spacing', feature) as number)
						: 0,
					// Where MapLibre puts the baseline: lower for the glyphs it draws itself, which
					// it does without the style's glyphs and for scripts whose letters combine.
					baseline:
						typeof job.style.glyphs !== 'string' || drawnByFontEngine(text)
							? TEXT_BASELINE.local
							: TEXT_BASELINE.server,
				}
			: undefined;
		if (!iconStyle && !labelStyle) continue;

		// The label's glyphs, if all their ranges could be loaded and MapLibre draws it with them:
		// then it is measured with their metrics and drawn as them, without the characters the
		// ranges have no glyph for, as MapLibre leaves those out; else measured with Noto Sans and
		// drawn as text.
		const fontStack = labelStyle?.font.join(',') ?? '';
		const rangeOf = (codePoint: number): GlyphRange | undefined =>
			glyphRanges.get(`${fontStack}\0${String(rangeStart(codePoint))}`);
		const glyphAt = (codePoint: number): Glyph | undefined => rangeOf(codePoint)?.get(codePoint);
		const asGlyphs =
			glyphMode &&
			labelStyle !== undefined &&
			!drawnByFontEngine(labelStyle.text) &&
			hasGlyphRanges(drawnCharacters(labelStyle.text), rangeOf);
		const fallbackMetrics = tableMetrics(labelStyle?.font);
		const metrics = asGlyphs ? glyphMetrics(glyphAt, fallbackMetrics) : fallbackMetrics;
		const outlineOf = (codePoint: number): GlyphOutline | undefined => {
			const glyph = glyphAt(codePoint);
			if (!glyph) return undefined;
			const key = `${fontStack}\0${String(codePoint)}`;
			let outline = context.outlines.get(key);
			if (!outline) {
				outline = traceGlyph(glyph, key);
				context.outlines.set(key, outline);
			}
			return outline;
		};
		const textOverlay = job.labels === 'glyphs-text';

		const options: CollisionOptions = {
			textOverlap: overlapMode(
				getLayout('text-overlap', feature),
				getLayout('text-allow-overlap', feature),
			),
			iconOverlap: overlapMode(
				getLayout('icon-overlap', feature),
				getLayout('icon-allow-overlap', feature),
			),
			textIgnorePlacement: getLayout('text-ignore-placement', feature) === true,
			iconIgnorePlacement: getLayout('icon-ignore-placement', feature) === true,
			textOptional: getLayout('text-optional', feature) === true,
			iconOptional: getLayout('icon-optional', feature) === true,
		};
		const textPadding = getLayout('text-padding', feature) as number;
		const iconPadding = (getLayout('icon-padding', feature) as { values: number[] }).values;

		const placement = getLayout('symbol-placement', feature) as string;
		// icon-text-fit: the icon spans its label's box, from the label's point.
		const textFit = getLayout('icon-text-fit', feature) as 'none' | 'width' | 'height' | 'both';
		const fitPadding = getLayout('icon-text-fit-padding', feature) as number[];
		const fitted = (icon: IconStyle, textBox: Box | undefined): IconStyle =>
			textFit === 'none' || !textBox
				? icon
				: { ...icon, fit: fitIconToText(icon, sprite!, textBox, textFit, fitPadding) };
		const textTranslate = screenTranslate(
			job,
			getPaint('text-translate', feature),
			getPaint('text-translate-anchor', feature),
		);
		const iconTranslate = screenTranslate(
			job,
			getPaint('icon-translate', feature),
			getPaint('icon-translate-anchor', feature),
		);
		const pointAtAnchor = (x: number, y: number): LayerFeature =>
			new LayerFeature({
				type: 'Point',
				geometry: [[new Point2D(x, y)]],
				id: feature.id,
				properties: feature.properties,
			});

		if (placement === 'point' || feature.type === 'Point') {
			// A point label is broken into lines of at most `text-max-width` ems, each kept as
			// written (drawn as text) and as drawn (as glyphs).
			const lines = labelStyle
				? labelLines(
						labelStyle.text,
						metrics,
						getLayout('text-max-width', feature) as number,
						labelStyle.letterSpacing,
					)
				: [];
			const lineHeight = getLayout('text-line-height', feature) as number;
			const justify = getLayout('text-justify', feature) as string;
			// Aligned to the map, a label or icon turns with it; to the viewport (the default for
			// points), it stays upright.
			const mapRotation = -(job.projection?.bearing ?? 0);
			const turn = (alignment: unknown): number => (alignment === 'map' ? mapRotation : 0);
			const textTurn = turn(getLayout('text-rotation-alignment', feature));
			const iconTurn = turn(getLayout('icon-rotation-alignment', feature));
			const lineStyle: SymbolStyle | undefined =
				labelStyle && lines.length > 0
					? {
							...labelStyle,
							text: lines.map((line) => line.text).join('\n'),
							rotate: labelStyle.rotate + textTurn,
						}
					: undefined;
			// With variable anchors, the places to try, each with the label anchored there.
			const places =
				lineStyle &&
				anchorOffsets({
					variableAnchorOffset: getLayout('text-variable-anchor-offset', feature),
					variableAnchor: getLayout('text-variable-anchor', feature),
					radialOffset: radial(feature),
					textOffset: getLayout('text-offset', feature) as [number, number],
				});
			// MapLibre moves a label to each place by its padded box, so one `text-padding`
			// further from its point than the anchor alone would put it.
			const padding = textPadding / (lineStyle?.size ?? 1);
			const styles: (SymbolStyle | undefined)[] = places
				? places.map(({ anchor, offset }) => ({
						...lineStyle,
						anchor,
						offset: [
							offset[0] +
								(anchor.endsWith('left') ? padding : anchor.endsWith('right') ? -padding : 0),
							offset[1] +
								(anchor.startsWith('top') ? padding : anchor.startsWith('bottom') ? -padding : 0),
						] as [number, number],
					}))
				: [lineStyle];
			const iconFor = (style: SymbolStyle | undefined): IconStyle | undefined =>
				iconStyle &&
				fitted(
					{ ...iconStyle, rotate: iconStyle.rotate + iconTurn },
					style ? layoutText(0, 0, style, lines, lineHeight, justify, metrics).box : undefined,
				);
			// Only an icon fitted to its label moves with it.
			const icons = textFit === 'none' ? [iconFor(styles[0])] : styles.map(iconFor);
			// `text-writing-mode`, for a label that may be set vertically: across, vertically, or
			// one if the other cannot be placed. Set vertically, punctuation takes its vertical
			// forms before the label is broken into lines.
			const modes = writingModesOf(getLayout('text-writing-mode', feature));
			const verticalLines =
				labelStyle &&
				placement === 'point' &&
				modes.includes('vertical') &&
				allowsVerticalWritingMode(labelStyle.text)
					? labelLines(
							withVerticalPunctuation(labelStyle.text),
							metrics,
							getLayout('text-max-width', feature) as number,
							labelStyle.letterSpacing,
						)
					: undefined;
			const writingModes = verticalLines ? modes : ['horizontal'];
			for (const point of labelAnchors(feature)) {
				// text-translate and icon-translate move the label and the icon, and what they block.
				const tx = point.x + textTranslate[0];
				const ty = point.y + textTranslate[1];
				const ix = point.x + iconTranslate[0];
				const iy = point.y + iconTranslate[1];
				const placeLabel = (
					style: SymbolStyle,
				): { label: [LayerFeature, SymbolStyle]; textBoxes: Box[] } => {
					const layout = layoutText(tx, ty, style, lines, lineHeight, justify, metrics);
					const drawn = drawnLines(
						style,
						layout,
						asGlyphs
							? glyphsOfLines(layout.lineBoxes, style, outlineOf, tx, ty, metrics)
							: undefined,
						textOverlay,
					);
					return {
						label: [pointAtAnchor(tx, ty), drawn],
						textBoxes: [paddedBox(layout.box, style, tx, ty, textPadding)],
					};
				};
				const placeIcon = (icon: IconStyle | undefined) =>
					icon && {
						icon: [pointAtAnchor(ix, iy), icon] as [LayerFeature, IconStyle],
						iconBox: iconBox(ix, iy, icon, sprite!, iconPadding),
					};
				// Set vertically: at the label's anchor, or centered and moved to each place by its
				// box turned upright, as MapLibre moves it (`calculateVariableRenderShift`). An icon
				// fitted to the label stays fitted to it set across.
				const placeVertically = (style: SymbolStyle, lines: LabelLine[]) => {
					const placeAt = ({ path, box }: VerticalLayout) => ({
						label: [
							pointAtAnchor(tx, ty),
							asGlyphs
								? {
										...style,
										path,
										glyphs: glyphsAlongPath(path, style, outlineOf, metrics),
										textOverlay,
									}
								: { ...style, path },
						] as [LayerFeature, SymbolStyle],
						textBoxes: [box],
					});
					const layout = (offset: [number, number]) =>
						layoutVerticalText(
							tx,
							ty,
							{ ...style, offset },
							lines,
							lineHeight,
							metrics,
							textPadding,
						);
					if (!places) return [placeAt(layout(style.offset))];
					const centered = layout([0, 0]);
					const [left, top, right, bottom] = centered.box;
					return places.map(({ anchor, offset }) => {
						const across = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? 1 : 0.5;
						const down = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : 0.5;
						const dx = (0.5 - across) * (right - left) + offset[0] * style.size;
						const dy = (0.5 - down) * (bottom - top) + offset[1] * style.size;
						return placeAt({
							path: centered.path.map((glyph) => ({ ...glyph, x: glyph.x + dx, y: glyph.y + dy })),
							box: [left + dx, top + dy, right + dx, bottom + dy],
						});
					});
				};
				const across = styles.flatMap((style, i) =>
					style
						? [{ ...placeLabel(style), ...(textFit === 'none' ? {} : placeIcon(icons[i])) }]
						: [],
				);
				// Each writing mode's places, tried one mode after the other.
				const tries = writingModes.flatMap((mode, group) =>
					(mode === 'vertical' && lineStyle && verticalLines
						? placeVertically(lineStyle, verticalLines)
						: across
					).map((place) => ({ ...place, group })),
				);
				const first = tries[0];
				const firstIcon = placeIcon(icons[0]);
				entries.push({
					icon: firstIcon?.icon,
					label: first?.label,
					iconBox: firstIcon?.iconBox,
					textBoxes: first?.textBoxes,
					anchors:
						places || writingModes.length !== 1 || writingModes[0] !== 'horizontal'
							? tries
							: undefined,
					options,
					showIcon: false,
					showText: false,
				});
			}
			continue;
		}

		// Along lines: anchors repeated along each line, where the label fits.
		// "auto" means "map" for symbols along lines.
		const alignedToMap = (alignment: unknown): boolean =>
			alignment === 'map' || alignment === 'auto';
		const textAlongLine =
			labelStyle !== undefined && alignedToMap(getLayout('text-rotation-alignment', feature));
		const iconAlongLine =
			iconStyle !== undefined && alignedToMap(getLayout('icon-rotation-alignment', feature));
		// Along a line, a label is one line, its glyphs in the order they are drawn.
		const single = labelStyle && singleLine(labelStyle.text, metrics);
		// Fitted, the icon spans the label as if it were straight.
		const lineIconStyle =
			iconStyle &&
			fitted(
				iconStyle,
				labelStyle &&
					single &&
					layoutText(0, 0, labelStyle, [single], undefined, undefined, metrics).box,
			);
		const glyphs = labelStyle && single && glyphAdvances(single.glyphs, metrics, labelStyle.size);
		const keepUpright = getLayout('text-keep-upright', feature) !== false;
		// Kept upright, a label with Chinese, Japanese or Korean is also set vertically, as in
		// MapLibre, which spaces and fits its labels along the line by that length then.
		const vertical =
			glyphs && textAlongLine && keepUpright && allowsVerticalWritingMode(single.text)
				? verticalLayout(glyphs.chars, metrics, labelStyle.size)
				: undefined;
		const textLength = (vertical ?? glyphs)?.advances.reduce((sum, width) => sum + width, 0) ?? 0;
		const iconBounds = lineIconStyle && quadsBox(iconQuads(lineIconStyle, sprite!));
		const iconLength = iconBounds ? iconBounds[2] - iconBounds[0] : 0;
		const labelLength = Math.max(textLength, iconLength);
		const textSize = labelStyle?.size ?? (getLayout('text-size', feature) as number);
		// Spacing is in pixels of the tile's zoom level, whose tiles a fractional zoom enlarges.
		const spacing =
			(getLayout('symbol-spacing', feature) as number) *
			2 ** (job.view.zoom - Math.floor(job.view.zoom));
		const maxAngle = ((getLayout('text-max-angle', feature) as number) * Math.PI) / 180;

		for (const points of feature.geometry) {
			const line = measureLine(points);
			for (const distance of lineAnchors(line, labelLength, spacing, textSize, placement)) {
				// MapLibre leaves out a label where its line bends too sharply.
				if (textAlongLine && !fitsMaxAngle(line, distance, textLength, textSize * 0.6, maxAngle)) {
					continue;
				}
				const anchor = pointAt(line, distance);
				const at = pointAtAnchor(anchor.x, anchor.y);
				const lineAngle = (anchor.angle * 180) / Math.PI;

				let label: [LayerFeature, SymbolStyle] | undefined;
				let textBoxes: Box[] | undefined;
				if (labelStyle && glyphs && textAlongLine) {
					const offset: [number, number] = [
						labelStyle.offset[0] * labelStyle.size,
						labelStyle.offset[1] * labelStyle.size,
					];
					let placed = layoutAlongLine(
						line,
						distance,
						glyphs.chars,
						glyphs.advances,
						offset,
						keepUpright,
					);
					let advances = glyphs.advances;
					// Along a line that runs more up and down than across, it is set vertically.
					if (vertical && runsVertically(placed)) {
						advances = vertical.advances;
						placed = layoutVertically(
							line,
							distance,
							vertical.chars,
							advances,
							vertical.upright,
							offset,
							labelStyle.size,
						);
					}
					const path = placed.map((glyph) => ({
						...glyph,
						x: glyph.x + textTranslate[0],
						y: glyph.y + textTranslate[1],
					}));
					label = [
						at,
						asGlyphs
							? {
									...labelStyle,
									path,
									glyphs: glyphsAlongPath(path, labelStyle, outlineOf, metrics),
									textOverlay,
								}
							: { ...labelStyle, path },
					];
					textBoxes = path.map((glyph, i) =>
						glyphBox(glyph, advances[i]!, labelStyle.size, textPadding),
					);
				} else if (labelStyle && single) {
					const tx = anchor.x + textTranslate[0];
					const ty = anchor.y + textTranslate[1];
					const layout = layoutText(tx, ty, labelStyle, [single], undefined, undefined, metrics);
					label = [
						pointAtAnchor(tx, ty),
						drawnLines(
							labelStyle,
							layout,
							asGlyphs
								? glyphsOfLines(layout.lineBoxes, labelStyle, outlineOf, tx, ty, metrics)
								: undefined,
							textOverlay,
						),
					];
					textBoxes = [paddedBox(layout.box, labelStyle, tx, ty, textPadding)];
				}

				const lineIcon =
					lineIconStyle && iconAlongLine
						? { ...lineIconStyle, rotate: lineIconStyle.rotate + lineAngle }
						: lineIconStyle;
				const ix = anchor.x + iconTranslate[0];
				const iy = anchor.y + iconTranslate[1];
				entries.push({
					icon: lineIcon && [pointAtAnchor(ix, iy), lineIcon],
					label,
					iconBox: lineIcon && iconBox(ix, iy, lineIcon, sprite!, iconPadding),
					textBoxes,
					options,
					showIcon: false,
					showText: false,
				});
			}
		}
	}
	return entries;
}

/**
 * The writing modes of `text-writing-mode`, each once, in order: across only if not given.
 */
function writingModesOf(value: unknown): string[] {
	if (!Array.isArray(value)) return ['horizontal'];
	const modes = (value as unknown[]).filter(
		(mode): mode is string => mode === 'horizontal' || mode === 'vertical',
	);
	return [...new Set(modes)];
}

/**
 * A label's graphemes `chars` set vertically (see `verticalText`), with the length each takes
 * along the line: one em upright, its advance on its side.
 */
function verticalLayout(
	chars: string[],
	metrics: FontMetrics,
	size: number,
): VerticalText & { advances: number[] } {
	const vertical = verticalText(chars);
	return {
		...vertical,
		advances: vertical.chars.map((char, i) =>
			vertical.upright[i] ? size : metrics.advance(char) * size,
		),
	};
}

/**
 * Whether the glyph range of every character of `text` (as drawn, see `drawnCharacters`) could
 * be loaded, except for white space, which needs no glyph.
 */
function hasGlyphRanges(
	text: string,
	rangeOf: (codePoint: number) => GlyphRange | undefined,
): boolean {
	for (const char of text) {
		if (!/\s/.test(char) && !rangeOf(char.codePointAt(0)!)) return false;
	}
	return true;
}

/**
 * A label at a point as the renderers draw it: as text, line by line; or as its `glyphs`,
 * with the text, invisible, line by line over them and as wide as they are.
 */
function drawnLines(
	style: SymbolStyle,
	layout: TextLayout,
	glyphs: PlacedGlyph[] | undefined,
	textOverlay: boolean,
): SymbolStyle {
	if (!glyphs) return { ...style, lines: layout.lines, justify: layout.justify };
	return {
		...style,
		glyphs,
		textOverlay,
		lines: layout.lineBoxes.map((line) => ({
			text: line.text,
			x: line.left + line.width / 2,
			y: line.y,
			width: line.width,
		})),
		justify: 'center',
	};
}

/**
 * The glyphs of a label's lines, as MapLibre places them: along each line as drawn from its
 * start, one advance after the other, turned with `text-rotate` around the label's point `x`, `y`.
 */
function glyphsOfLines(
	lineBoxes: { glyphs: string; left: number; y: number }[],
	style: SymbolStyle,
	outlineOf: (codePoint: number) => GlyphOutline | undefined,
	x: number,
	y: number,
	metrics: FontMetrics,
): PlacedGlyph[] {
	const scale = style.size / GLYPH_EM;
	const spacing = (style.letterSpacing ?? 0) * style.size;
	const radians = (style.rotate * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const placed: PlacedGlyph[] = [];
	for (const line of lineBoxes) {
		let pen = line.left;
		for (const char of line.glyphs) {
			const advance = metrics.advance(char) * style.size;
			const outline = outlineOf(char.codePointAt(0)!);
			if (outline) {
				const dx = pen + advance / 2 - x;
				const dy = line.y - y;
				placed.push({
					outline,
					x: x + dx * cos - dy * sin,
					y: y + dx * sin + dy * cos,
					angle: style.rotate,
					scale,
				});
			}
			pen += advance + spacing;
		}
	}
	return placed;
}

/**
 * The glyphs of a label along a line: each grapheme's glyphs at its place on the line,
 * turned with it (a letter's accents follow the letter along the line).
 */
function glyphsAlongPath(
	path: GlyphPlacement[],
	style: SymbolStyle,
	outlineOf: (codePoint: number) => GlyphOutline | undefined,
	metrics: FontMetrics,
): PlacedGlyph[] {
	const scale = style.size / GLYPH_EM;
	const placed: PlacedGlyph[] = [];
	for (const grapheme of path) {
		const radians = (grapheme.angle * Math.PI) / 180;
		let along = -(metrics.advance(grapheme.text) * style.size) / 2;
		for (const char of grapheme.text) {
			const advance = metrics.advance(char) * style.size;
			const outline = outlineOf(char.codePointAt(0)!);
			if (outline) {
				const offset = along + advance / 2;
				placed.push({
					outline,
					x: grapheme.x + offset * Math.cos(radians),
					y: grapheme.y + offset * Math.sin(radians),
					angle: grapheme.angle,
					scale,
				});
			}
			along += advance;
		}
	}
	return placed;
}

/** Draws the symbols of a layer that collision detection kept: icons first, then labels. */
export async function renderSymbolLayer(layer: Layer, symbols: SymbolEntry[]): Promise<void> {
	const { job, layerStyle, spriteAtlas } = layer;
	// With variable anchors, the label (and a fitted icon) where it was placed.
	const placed = (symbol: SymbolEntry) => {
		const chosen = symbol.anchor !== undefined ? symbol.anchors?.[symbol.anchor] : undefined;
		return { label: chosen?.label ?? symbol.label, icon: chosen?.icon ?? symbol.icon };
	};
	const icons = symbols.flatMap((symbol) => {
		const { icon } = placed(symbol);
		return symbol.showIcon && icon ? [icon] : [];
	});
	const labels = symbols.flatMap((symbol) => {
		const { label } = placed(symbol);
		return symbol.showText && label ? [label] : [];
	});
	await job.renderer.drawIcons(`${layerStyle.id}-icons`, icons, spriteAtlas);
	job.renderer.drawLabels(`${layerStyle.id}-labels`, labels);
}
