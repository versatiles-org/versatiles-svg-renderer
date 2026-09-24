import type { Color as MaplibreColor } from '@maplibre/maplibre-gl-style-spec';
import { Feature as LayerFeature, Point2D } from '../../geometry.js';
import { fitIconToText, iconQuads, quadsBox } from '../../renderer/icon_quads.js';
import type { GlyphPlacement, IconStyle, PlacedGlyph, SymbolStyle } from '../../renderer/types.js';
import { type Glyph, GLYPH_EM, type GlyphRange, rangeStart } from '../../sources/index.js';
import {
	glyphBox,
	iconBox,
	layoutText,
	paddedBox,
	type Box,
	type CollisionOptions,
	type PlacedSymbol,
} from '../collision.js';
import { traceGlyph, type GlyphOutline } from '../glyph_outline.js';
import { labelAnchors } from '../label_anchors.js';
import {
	fitsMaxAngle,
	layoutAlongLine,
	lineAnchors,
	measureLine,
	pointAt,
} from '../line_labels.js';
import {
	breakLines,
	glyphAdvances,
	glyphMetrics,
	tableMetrics,
	type FontMetrics,
} from '../text_metrics.js';
import { anchorOffsets, radialOffset } from '../variable_anchor.js';
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
export interface SymbolEntry extends PlacedSymbol {
	icon?: [LayerFeature, IconStyle];
	label?: [LayerFeature, SymbolStyle];
	/** The label, and the icon if fitted to it, at each place to try (see `PlacedSymbol`). */
	anchors?: (NonNullable<PlacedSymbol['anchors']>[number] & {
		label?: [LayerFeature, SymbolStyle];
		icon?: [LayerFeature, IconStyle];
	})[];
}

/**
 * The symbols of a layer, in the order they are placed and drawn: each feature's label
 * and icon at each point it is placed at, with their collision boxes.
 */
export async function prepareSymbolLayer(layer: Layer): Promise<SymbolEntry[]> {
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
	// metrics: all ranges the layer's labels use, loaded together.
	const glyphMode = job.labels === 'glyphs' || job.labels === 'glyphs-text';
	const glyphRanges = new Map<string, GlyphRange | undefined>();
	if (glyphMode) {
		const wanted = new Set<string>();
		for (const feature of symbolFeatures) {
			const fontStack = (getLayout('text-font', feature) as string[]).join(',');
			for (const char of labelText(feature)) {
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
					letterSpacing: getLayout('text-letter-spacing', feature) as number,
				}
			: undefined;
		if (!iconStyle && !labelStyle) continue;

		// The label's glyphs, if all of them could be loaded: then it is measured with their
		// metrics and drawn as them; else measured with Noto Sans and drawn as text.
		const fontStack = labelStyle?.font.join(',') ?? '';
		const glyphAt = (codePoint: number): Glyph | undefined =>
			glyphRanges.get(`${fontStack}\0${String(rangeStart(codePoint))}`)?.get(codePoint);
		const asGlyphs =
			glyphMode && labelStyle !== undefined && hasAllGlyphs(labelStyle.text, glyphAt);
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
			textAllowOverlap: getLayout('text-allow-overlap', feature) === true,
			iconAllowOverlap: getLayout('icon-allow-overlap', feature) === true,
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
			// A point label is broken into lines of at most `text-max-width` ems.
			const lines = labelStyle
				? breakLines(
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
					? { ...labelStyle, text: lines.join('\n'), rotate: labelStyle.rotate + textTurn }
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
					let drawn: SymbolStyle = layout.lines
						? { ...style, lines: layout.lines, justify: layout.justify }
						: style;
					if (asGlyphs) {
						drawn = {
							...style,
							glyphs: glyphsOfLines(layout.lineBoxes, style, outlineOf, tx, ty, metrics),
							textOverlay,
							// The invisible text, line by line, as wide as the glyphs.
							lines: layout.lineBoxes.map((line) => ({
								text: line.text,
								x: line.left + line.width / 2,
								y: line.y,
								width: line.width,
							})),
							justify: 'center',
						};
					}
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
				const first = styles[0] && placeLabel(styles[0]);
				const firstIcon = placeIcon(icons[0]);
				entries.push({
					icon: firstIcon?.icon,
					label: first?.label,
					iconBox: firstIcon?.iconBox,
					textBoxes: first?.textBoxes,
					anchors: places
						? styles.map((style, i) => ({
								...placeLabel(style!),
								...(textFit === 'none' ? {} : placeIcon(icons[i])),
							}))
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
		// Fitted, the icon spans the label as if it were straight.
		const lineIconStyle =
			iconStyle &&
			fitted(
				iconStyle,
				labelStyle &&
					layoutText(0, 0, labelStyle, [labelStyle.text], undefined, undefined, metrics).box,
			);
		// Along a line, a label is one line.
		const glyphs =
			labelStyle && glyphAdvances(labelStyle.text.replace(/\s+/g, ' '), metrics, labelStyle.size);
		const textLength = glyphs ? glyphs.advances.reduce((sum, width) => sum + width, 0) : 0;
		const iconBounds = lineIconStyle && quadsBox(iconQuads(lineIconStyle, sprite!));
		const iconLength = iconBounds ? iconBounds[2] - iconBounds[0] : 0;
		const labelLength = Math.max(textLength, iconLength);
		const textSize = labelStyle?.size ?? (getLayout('text-size', feature) as number);
		// Spacing is in pixels of the tile's zoom level, whose tiles a fractional zoom enlarges.
		const spacing =
			(getLayout('symbol-spacing', feature) as number) *
			2 ** (job.view.zoom - Math.floor(job.view.zoom));
		const maxAngle = ((getLayout('text-max-angle', feature) as number) * Math.PI) / 180;
		const keepUpright = getLayout('text-keep-upright', feature) !== false;

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
					const path = layoutAlongLine(
						line,
						distance,
						glyphs.chars,
						glyphs.advances,
						offset,
						keepUpright,
					).map((glyph) => ({
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
						glyphBox(glyph, glyphs.advances[i]!, labelStyle.size, textPadding),
					);
				} else if (labelStyle) {
					const tx = anchor.x + textTranslate[0];
					const ty = anchor.y + textTranslate[1];
					const layout = layoutText(
						tx,
						ty,
						labelStyle,
						[labelStyle.text],
						undefined,
						undefined,
						metrics,
					);
					label = [
						pointAtAnchor(tx, ty),
						asGlyphs
							? {
									...labelStyle,
									glyphs: glyphsOfLines(layout.lineBoxes, labelStyle, outlineOf, tx, ty, metrics),
									textOverlay,
								}
							: labelStyle,
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

/** Whether every character of `text` has a glyph, except white space, which needs none. */
function hasAllGlyphs(text: string, glyphAt: (codePoint: number) => Glyph | undefined): boolean {
	for (const char of text) {
		if (!/\s/.test(char) && !glyphAt(char.codePointAt(0)!)) return false;
	}
	return true;
}

/**
 * The glyphs of a label's lines, as MapLibre places them: along each line from its start,
 * one advance after the other, turned with `text-rotate` around the label's point `x`, `y`.
 */
function glyphsOfLines(
	lineBoxes: { text: string; left: number; y: number }[],
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
		for (const char of line.text) {
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
