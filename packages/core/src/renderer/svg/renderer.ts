import type { Feature } from '../../geometry.js';
import { Color } from '../color.js';
import {
	chainSegments,
	iconQuads,
	JUSTIFY_ANCHOR,
	letterSpacingShift,
	linePatternStrips,
	mapTextAnchor,
	type Segment,
	strokeLines,
} from '../../layout/index.js';
import { SvgDefs } from './defs.js';
import {
	escapeXml,
	fillAttr,
	formatNum,
	formatPoint,
	formatScale,
	formatScaled,
	formatUnit,
	opacityAttr,
	roundXY,
	segmentsToPath,
	strokeAttr,
} from './format.js';
import type {
	BackgroundStyle,
	CircleStyle,
	FillStyle,
	GlyphPlacement,
	IconStyle,
	LinePattern,
	PlacedGlyph,
	LineStyle,
	RasterStyle,
	RasterTriangle,
	RasterTile,
	RendererOptions,
	SymbolStyle as LabelStyle,
} from '../../types.js';
import type { SpriteAtlas } from '../../sources/index.js';
import type { ClipCircle } from '../../projection.js';
import { circleGradient, circleShape } from '../circle.js';
import {
	affineFromTriangles,
	bleedAtTileBorder,
	growTriangle,
	isOnTileBorder,
	RASTER_TILE_UNITS,
	RASTER_TRIANGLE_OVERLAP_PX,
	type Triangle,
} from '../raster_mesh.js';

// line-blur approximates MapLibre's edge-feather blur, which keeps an opaque core
// and feathers over ~`blur` px with a hard cutoff. feGaussianBlur alone conserves
// total ink and leaves soft, infinite tails, so we combine three corrections,
// calibrated against MapLibre's output in the e2e comparison:
//   1. fade the line by width/(width + K*blur) to match MapLibre's reduced intensity,
//   2. blur at stdDeviation = blur * STD_FACTOR (a Gaussian matches a narrower feather),
//   3. steepen the resulting alpha with feComponentTransfer (slope>1, intercept<0) to
//      clip the Gaussian tails toward MapLibre's hard edge.
// The constants below were calibrated against MapLibre via the e2e geojson comparison.
const BLUR_STD_FACTOR = 0.15;
const BLUR_OPACITY_K = 1.5;
const BLUR_ALPHA_SLOPE = 1.5;
const BLUR_ALPHA_INTERCEPT = -0.6;

// MapLibre's fill-antialias draws a ~1px edge feather along every fill boundary.
// We approximate it with a thin stroke in fill-outline-color; the width (in user
// px) is tuned against the e2e comparison.
const FILL_OUTLINE_WIDTH_PX = 0.5;

export class SVGRenderer {
	public readonly width: number;

	public readonly height: number;

	readonly #svg: string[];

	readonly #defs = new SvgDefs();

	#rasterClipCount = 0;

	#linePatternMaskCount = 0;

	#clipCircle: ClipCircle | undefined;

	public constructor(opt: RendererOptions) {
		this.width = opt.width;
		this.height = opt.height;
		this.#svg = [];
	}

	public setClipCircle(circle: ClipCircle): void {
		this.#clipCircle = circle;
	}

	public drawBackgroundFill(style: BackgroundStyle): void {
		// Every background layer paints over what is below it, like any other layer. (A
		// transparent one, e.g. an empty "slot" layer, must not erase an earlier background.)
		const rect = `x="-1" y="-1" width="${(this.width + 2).toFixed(0)}" height="${(this.height + 2).toFixed(0)}"`;
		if (style.pattern) {
			if (style.opacity <= 0) return;
			const opacity = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';
			this.#svg.push(`<rect ${rect} fill="${this.#defs.fillPattern(style.pattern)}"${opacity} />`);
			return;
		}
		const color = new Color(style.color);
		color.alpha *= style.opacity;
		if (color.alpha <= 0) return;
		this.#svg.push(`<rect ${rect} ${fillAttr(color)} />`);
	}

	public drawPolygons(id: string, features: [Feature, FillStyle][]): void {
		if (features.length === 0) return;

		// Merge only *consecutive* features with identical attributes, so the paint
		// order of overlapping features matches MapLibre's source order. A global
		// merge would reorder interleaved features (e.g. data-driven fill colors).
		// Translucent features are never merged: MapLibre blends each one separately,
		// so where they overlap, their opacity adds up — within one merged <path> it
		// would not. Fills and their antialias outlines are collected in one pass but
		// emitted as two: MapLibre draws every fill first, then every outline, so a
		// lower feature's outline composites on top of a later overlapping fill.
		const fillGroups: { segments: Segment[]; attrs: string }[] = [];
		const outlineGroups: { closed: Segment[]; open: Segment[]; attrs: string }[] = [];
		let currentFillKey: string | undefined;
		let currentOutlineKey: string | undefined;
		features.forEach(([feature, style]) => {
			if (style.opacity <= 0) return;

			const translate =
				style.translate[0] === 0 && style.translate[1] === 0
					? ''
					: ` transform="translate(${formatPoint(style.translate)})"`;
			const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';

			// Round each ring once; shared by the fill and the outline pass.
			const rings = feature.geometry.map((ring) => ring.map((p) => roundXY(p.x, p.y)));

			const color = new Color(style.color);
			// A pattern is drawn instead of the color, and may itself be translucent.
			const patternPaint = style.pattern && this.#defs.fillPattern(style.pattern);
			const translucent = style.opacity < 1 || (!patternPaint && color.alpha < 255);
			if (patternPaint ?? color.alpha > 0) {
				const paint = patternPaint ? `fill="${patternPaint}"` : fillAttr(color);
				const key = paint + translate + opacityAttr;
				if (translucent || key !== currentFillKey) {
					fillGroups.push({ segments: [], attrs: `${paint}${translate}${opacityAttr}` });
					currentFillKey = translucent ? undefined : key;
				}
				const group = fillGroups[fillGroups.length - 1]!;
				for (const ring of rings) group.segments.push(ring);
			}

			// fill-antialias outline, in fill-outline-color or else the fill color. For an
			// opaque fill, MapLibre's default outline IS its fill-edge antialiasing
			// (draw_fill.ts keeps it outside of the shape), and an SVG <path fill> is already
			// rasterizer-antialiased, so redrawing it is redundant: measured identical pixel
			// diff for +46–88% SVG size. It is drawn when it shows: in a distinct
			// fill-outline-color (choropleths), or for a translucent fill, where MapLibre
			// draws the outline over the fill's edge (e.g. buildings fading in).
			// Without a fill-outline-color, a pattern's outline is drawn with the pattern too,
			// as in MapLibre (its `fillOutlinePattern` program).
			if (style.antialias && (style.outlineColor !== undefined || translucent)) {
				const outlineColor =
					style.outlineColor !== undefined ? new Color(style.outlineColor) : color;
				const outlinePattern = style.outlineColor === undefined ? patternPaint : undefined;
				if (outlinePattern ?? outlineColor.alpha > 0) {
					const outlineTranslucent = translucent || outlineColor.alpha < 255;
					const width = formatScaled(FILL_OUTLINE_WIDTH_PX);
					const stroke = outlinePattern
						? `stroke="${outlinePattern}" stroke-width="${width}"`
						: strokeAttr(outlineColor, width);
					const key = stroke + translate + opacityAttr;
					if (outlineTranslucent || key !== currentOutlineKey) {
						outlineGroups.push({
							closed: [],
							open: [],
							attrs: `fill="none" ${stroke}${translate}${opacityAttr}`,
						});
						currentOutlineKey = outlineTranslucent ? undefined : key;
					}
					const group = outlineGroups[outlineGroups.length - 1]!;
					// A polygon clipped to its tile has an outline without the clipped edges.
					if (feature.outline) {
						for (const line of feature.outline) {
							group.open.push(line.map((p) => roundXY(p.x, p.y)));
						}
					} else {
						for (const ring of rings) group.closed.push(ring);
					}
				}
			}
		});

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const { segments, attrs } of fillGroups) {
			this.#svg.push(`<path d="${segmentsToPath(segments, true)}" ${attrs} />`);
		}
		for (const { closed, open, attrs } of outlineGroups) {
			const d = segmentsToPath(closed, true) + segmentsToPath(open, false);
			this.#svg.push(`<path d="${d}" ${attrs} />`);
		}
		this.#svg.push('</g>');
	}

	public drawLineStrings(id: string, features: [Feature, LineStyle][]): void {
		if (features.length === 0) return;

		// Merge only *consecutive* same-attribute features (see drawPolygons) so the
		// paint order of overlapping lines matches MapLibre's source order. Translucent
		// lines are never merged: MapLibre blends every line separately, so where lines
		// overlap (e.g. parallel rail tracks fading in), their opacity adds up — even
		// between the parts of one feature (tiles merge equal ways into one multi-line
		// feature). One <path> covers its overlaps only once, so a translucent line gets
		// a <path> per part.
		const groups: {
			segments: Segment[];
			rings: Segment[];
			attrs: string;
			separate: boolean;
			/** A line drawn with a pattern, as it is. */
			patterned?: string;
		}[] = [];
		let currentKey: string | undefined;
		features.forEach(([feature, style]) => {
			if (style.opacity <= 0) return;
			if (style.pattern) {
				if (style.width <= 0) return;
				const patterned = this.#patternedLine(feature, style, style.pattern);
				if (patterned)
					groups.push({ segments: [], rings: [], attrs: '', separate: true, patterned });
				currentKey = undefined;
				return;
			}
			const color = new Color(style.color);
			if (style.width <= 0 || color.alpha <= 0) return;

			const translate =
				style.translate[0] === 0 && style.translate[1] === 0
					? ''
					: ` transform="translate(${formatPoint(style.translate)})"`;
			const roundedWidth = formatScaled(style.width);
			const dasharrayStr = style.dasharray
				? style.dasharray.map((v) => formatScaled(v * style.width)).join(',')
				: '';
			// MapLibre's line-blur fades the line as the blur approaches its width
			// (the feather eats into the opaque core). A Gaussian conserves total ink,
			// so approximate that fade with an extra opacity factor; it tends to 1 for
			// blur << width (the common case) and to 0 as blur grows.
			const blurOpacity =
				style.blur > 0 ? style.width / (style.width + BLUR_OPACITY_K * style.blur) : 1;
			const effectiveOpacity = style.opacity * blurOpacity;
			const opacityAttr = effectiveOpacity < 1 ? ` opacity="${effectiveOpacity.toFixed(3)}"` : '';
			const filterAttr =
				style.blur > 0
					? ` filter="url(#${this.#defs.blurFilter(formatScaled(style.blur * BLUR_STD_FACTOR), [BLUR_ALPHA_SLOPE, BLUR_ALPHA_INTERCEPT])})"`
					: '';
			const key = [
				color.hex,
				roundedWidth,
				style.cap,
				style.join,
				String(style.miterLimit),
				dasharrayStr,
				opacityAttr,
				translate,
				filterAttr,
			].join('\0');

			const translucent = effectiveOpacity < 1 || color.alpha < 255;
			if (translucent || key !== currentKey) {
				const attrs = [
					'fill="none"',
					strokeAttr(color, roundedWidth),
					`stroke-linecap="${style.cap}"`,
					`stroke-linejoin="${style.join}"`,
					`stroke-miterlimit="${String(style.miterLimit)}"`,
				];
				if (dasharrayStr) attrs.push(`stroke-dasharray="${dasharrayStr}"`);
				groups.push({
					segments: [],
					rings: [],
					attrs: attrs.join(' ') + translate + opacityAttr + filterAttr,
					separate: translucent,
				});
				currentKey = translucent ? undefined : key;
			}
			const group = groups[groups.length - 1]!;

			const { open, closed } = strokeLines(
				feature.geometry,
				feature.type === 'Polygon',
				style.offset,
			);
			for (const line of open) group.segments.push(line.map((p) => roundXY(p.x, p.y)));
			for (const ring of closed) group.rings.push(ring.map((p) => roundXY(p.x, p.y)));
		});

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const { segments, rings, attrs, separate, patterned } of groups) {
			if (patterned) {
				this.#svg.push(patterned);
				continue;
			}
			if (separate) {
				for (const segment of segments) {
					this.#svg.push(`<path d="${segmentsToPath([segment])}" ${attrs} />`);
				}
				for (const ring of rings) {
					this.#svg.push(`<path d="${segmentsToPath([ring], true)}" ${attrs} />`);
				}
				continue;
			}
			const chains = chainSegments(segments);
			const d = segmentsToPath(chains) + segmentsToPath(rings, true);
			this.#svg.push(`<path d="${d}" ${attrs} />`);
		}
		this.#svg.push('</g>');
	}

	/**
	 * A line drawn with `line-pattern`: every segment covered with copies of the image along
	 * it (see `linePatternStrips`), all masked by the line as it is stroked, which draws its
	 * joins and caps and smooths its edges.
	 */
	#patternedLine(feature: Feature, style: LineStyle, pattern: LinePattern): string {
		const { open, closed } = strokeLines(
			feature.geometry,
			feature.type === 'Polygon',
			style.offset,
		);
		const strips = [
			...open.flatMap((line) => linePatternStrips(line, false, style.width)),
			...closed.flatMap((ring) => linePatternStrips(ring, true, style.width)),
		];
		if (strips.length === 0) return '';

		const toSegment = (line: { x: number; y: number }[]): Segment =>
			line.map((p) => roundXY(p.x, p.y));
		const d =
			segmentsToPath(chainSegments(open.map(toSegment))) +
			segmentsToPath(closed.map(toSegment), true);
		const maskId = `line-pattern-mask-${String(this.#linePatternMaskCount++)}`;
		const stroke = [
			`stroke="#fff" stroke-width="${formatScaled(style.width)}"`,
			`stroke-linecap="${style.cap}" stroke-linejoin="${style.join}"`,
			`stroke-miterlimit="${String(style.miterLimit)}"`,
		].join(' ');

		const fill = this.#defs.linePattern(pattern, style.width);
		const parts = strips.map(({ matrix, polygon }) => {
			// The path is in tenths of a pixel (see `roundXY`), which `formatScaled` undoes.
			const [a, b, c, dd, e, f] = matrix;
			const transform =
				[a, b, c, dd].map(formatUnit).join(',') + ',' + formatScaled(e) + ',' + formatScaled(f);
			const outline = segmentsToPath([polygon.map(([u, v]) => roundXY(u, v))], true);
			return `<path transform="matrix(${transform})" d="${outline}" fill="${fill}" />`;
		});

		// `line-blur` is left out: MapLibre fades a pattern's edges only slightly.
		let attrs = '';
		if (style.translate[0] !== 0 || style.translate[1] !== 0) {
			attrs += ` transform="translate(${formatPoint(style.translate)})"`;
		}
		if (style.opacity < 1) attrs += ` opacity="${style.opacity.toFixed(3)}"`;
		return (
			`<mask id="${maskId}"><path d="${d}" fill="none" ${stroke} /></mask>` +
			`<g${attrs}><g mask="url(#${maskId})">${parts.join('')}</g></g>`
		);
	}

	public drawCircles(id: string, features: [Feature, CircleStyle][]): void {
		if (features.length === 0) return;

		// Merge only *consecutive* same-attribute features (see drawPolygons) so the
		// paint order of overlapping circles matches MapLibre's source order.
		const groups: { points: [number, number][]; elements: string[] }[] = [];
		let currentKey: string | undefined;
		features.forEach(([feature, style]) => {
			const color = new Color(style.color);
			const strokeColor = new Color(style.strokeColor);
			const translate =
				style.translate[0] === 0 && style.translate[1] === 0
					? ''
					: ` transform="translate(${formatPoint(style.translate)})"`;

			let elements: string[];
			if ((style.blur ?? 0) > 0) {
				// Blurred: one circle, fill and stroke in a radial gradient that fades out.
				const { radius, stops } = circleGradient(
					style,
					{ rgb: color.rgbBytes, alpha: color.opacity },
					{ rgb: strokeColor.rgbBytes, alpha: strokeColor.opacity },
				);
				if (radius <= 0 || stops.every((stop) => stop.opacity <= 0)) return;
				elements = [
					`r="${formatScaled(radius)}" fill="url(#${this.#defs.circleGradient(stops)})"${translate}`,
				];
			} else {
				elements = this.#circleElements(style, color, strokeColor, translate);
				if (elements.length === 0) return;
			}
			const key = elements.join('\0');

			if (key !== currentKey) {
				groups.push({ points: [], elements });
				currentKey = key;
			}
			const group = groups[groups.length - 1]!;
			feature.geometry.forEach((ring) => {
				const p = ring[0];
				if (p) group.points.push(roundXY(p.x, p.y));
			});
		});

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const { points, elements } of groups) {
			for (const [x, y] of points) {
				for (const attrs of elements) {
					this.#svg.push(`<circle cx="${formatNum(x)}" cy="${formatNum(y)}" ${attrs} />`);
				}
			}
		}
		this.#svg.push('</g>');
	}

	/** The attributes of the `<circle>`s of an unblurred circle: fill and stroke, or none. */
	#circleElements(
		style: CircleStyle,
		color: Color,
		strokeColor: Color,
		translate: string,
	): string[] {
		const { fill, stroke } = circleShape(style, color.opacity, strokeColor.opacity);
		if (!fill && !stroke) return [];
		const fillAttrs = fill
			? `fill="${color.rgb}"${opacityAttr('fill-opacity', fill.opacity)}`
			: 'fill="none"';
		const strokeAttrs = stroke
			? ` stroke="${strokeColor.rgb}" stroke-width="${formatScaled(stroke.width)}"${opacityAttr('stroke-opacity', stroke.opacity)}`
			: '';
		// One element when fill and stroke share a radius, else the fill and a ring.
		const elements =
			!fill || !stroke || fill.radius === stroke.radius
				? [`r="${formatScaled((stroke ?? fill)!.radius)}" ${fillAttrs}${strokeAttrs}${translate}`]
				: [
						`r="${formatScaled(fill.radius)}" ${fillAttrs}${translate}`,
						`r="${formatScaled(stroke.radius)}" fill="none"${strokeAttrs}${translate}`,
					];
		return elements;
	}

	public drawLabels(id: string, features: [Feature, LabelStyle][]): void {
		if (features.length === 0) return;

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const [feature, style] of features) {
			if (style.opacity <= 0 || !style.text) continue;

			const color = new Color(style.color);
			if (color.alpha <= 0) continue;

			// Drawn as glyphs: their outlines, and maybe the text, invisible, over them.
			let invisible = false;
			if (style.glyphs) {
				this.#svg.push(this.#glyphLabel(style, style.glyphs, color));
				if (!style.textOverlay) continue;
				invisible = true;
			}

			if (style.path) {
				this.#svg.push(this.#labelAlongLine(style, style.path, color, invisible));
				continue;
			}

			// The pipeline places each symbol: its feature is a single point.
			const point = feature.geometry[0]?.[0];
			if (!point) continue;
			const [px, py] = roundXY(point.x, point.y);

			const fontSize = formatScaled(style.size);
			const fontFamily = style.font.join(', ') + ', Helvetica, Arial, sans-serif';
			const spacing = (style.letterSpacing ?? 0) * style.size;

			// Several lines: each a <tspan> at its point, the block placed by the pipeline.
			let content = escapeXml(style.text);
			let attrs: string[];
			if (style.lines) {
				const anchor = JUSTIFY_ANCHOR[style.justify ?? 'center'];
				const shift = letterSpacingShift(spacing, anchor);
				content = style.lines
					.map((line) => {
						const [x, y] = roundXY(line.x + shift, line.y);
						// Invisible over glyphs: as wide as they are, whatever font it is set in.
						const length =
							invisible && line.width
								? ` textLength="${formatScaled(line.width)}" lengthAdjust="spacingAndGlyphs"`
								: '';
						return `<tspan x="${formatNum(x)}" y="${formatNum(y)}"${length}>${escapeXml(line.text)}</tspan>`;
					})
					.join('');
				attrs = [
					`font-family="${escapeXml(fontFamily)}"`,
					`font-size="${fontSize}"`,
					`text-anchor="${anchor}"`,
					'dominant-baseline="central"',
				];
			} else {
				const [svgAnchor, baseline] = mapTextAnchor(style.anchor);
				const offsetX = style.offset[0] * style.size + letterSpacingShift(spacing, svgAnchor);
				const offsetY = style.offset[1] * style.size;
				const [dx, dy] = roundXY(offsetX, offsetY);
				attrs = [
					`x="${formatNum(px)}"`,
					`y="${formatNum(py)}"`,
					`font-family="${escapeXml(fontFamily)}"`,
					`font-size="${fontSize}"`,
					`text-anchor="${svgAnchor}"`,
					`dominant-baseline="${baseline}"`,
				];
				if (dx !== 0) attrs.push(`dx="${formatNum(dx)}"`);
				if (dy !== 0) attrs.push(`dy="${formatNum(dy)}"`);
			}
			if (spacing !== 0) attrs.push(`letter-spacing="${formatScale(spacing)}"`);

			if (style.rotate !== 0) {
				attrs.push(`transform="rotate(${String(style.rotate)},${formatNum(px)},${formatNum(py)})"`);
			}

			if (invisible) {
				if (style.opacity < 1) attrs.push(`opacity="${style.opacity.toFixed(3)}"`);
				this.#svg.push(`<text ${attrs.join(' ')} fill-opacity="0">${content}</text>`);
				continue;
			}
			const haloColor = new Color(style.haloColor);
			if (style.haloWidth > 0 && haloColor.alpha > 0) {
				const haloWidth = formatScaled(style.haloWidth);
				attrs.push(
					'paint-order="stroke fill"',
					`stroke="${haloColor.rgb}"`,
					`stroke-width="${haloWidth}"`,
					'stroke-linejoin="round"',
				);
				if (haloColor.alpha < 255) attrs.push(`stroke-opacity="${haloColor.opacity.toFixed(3)}"`);
			}

			attrs.push(fillAttr(color));
			if (style.opacity < 1) attrs.push(`opacity="${style.opacity.toFixed(3)}"`);

			this.#svg.push(`<text ${attrs.join(' ')}>${content}</text>`);
		}
		this.#svg.push('</g>');
	}

	/**
	 * A label along a line: each glyph centered on its place and turned with the line. All
	 * halos come first, then all glyphs, as MapLibre draws them, so a glyph's halo does not
	 * cover its neighbour.
	 */
	#labelAlongLine(
		style: LabelStyle,
		path: GlyphPlacement[],
		color: Color,
		invisible = false,
	): string {
		const fontFamily = style.font.join(', ') + ', Helvetica, Arial, sans-serif';
		const glyphs = path
			.map((glyph) => {
				const [x, y] = roundXY(glyph.x, glyph.y);
				const angle = Math.round(glyph.angle * 10) / 10;
				const rotate = angle === 0 ? '' : ` rotate(${String(angle)})`;
				return `<text transform="translate(${formatNum(x)},${formatNum(y)})${rotate}">${escapeXml(glyph.text)}</text>`;
			})
			.join('');
		const opacity = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';
		const parts = [
			`<g font-family="${escapeXml(fontFamily)}" font-size="${formatScaled(style.size)}" text-anchor="middle" dominant-baseline="central"${opacity}>`,
		];
		if (invisible) {
			parts.push(`<g fill-opacity="0">${glyphs}</g>`, '</g>');
			return parts.join('');
		}
		const haloColor = new Color(style.haloColor);
		if (style.haloWidth > 0 && haloColor.alpha > 0) {
			parts.push(
				`<g fill="none" ${strokeAttr(haloColor, formatScaled(style.haloWidth))} stroke-linejoin="round">${glyphs}</g>`,
			);
		}
		parts.push(`<g ${fillAttr(color)}>${glyphs}</g>`, '</g>');
		return parts.join('');
	}

	/**
	 * A label drawn as its glyphs' outlines: each glyph defined once, in the defs, and placed
	 * with `<use>`. All halos come first, then all glyphs, as MapLibre draws them.
	 */
	#glyphLabel(style: LabelStyle, glyphs: PlacedGlyph[], color: Color): string {
		const scale = glyphs[0]?.scale ?? 1;
		const uses = glyphs
			.map((glyph) => {
				const [x, y] = roundXY(glyph.x, glyph.y);
				const angle = Math.round(glyph.angle * 10) / 10;
				const rotate = angle === 0 ? '' : ` rotate(${String(angle)})`;
				return `<use xlink:href="#${this.#defs.glyph(glyph.outline)}" transform="translate(${formatNum(x)},${formatNum(y)})${rotate} scale(${formatScale(glyph.scale)})" />`;
			})
			.join('');
		const opacity = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';
		const parts = [`<g${opacity}>`];
		const haloColor = new Color(style.haloColor);
		if (style.haloWidth > 0 && haloColor.alpha > 0) {
			// The outlines are scaled; the halo's width is on screen.
			parts.push(
				`<g fill="none" stroke="${haloColor.rgb}" stroke-width="${formatScale(style.haloWidth / scale)}"${opacityAttr('stroke-opacity', haloColor.opacity)} stroke-linejoin="round">${uses}</g>`,
			);
		}
		parts.push(`<g ${fillAttr(color)}>${uses}</g>`, '</g>');
		return parts.join('');
	}

	public drawIcons(id: string, features: [Feature, IconStyle][], spriteAtlas: SpriteAtlas): void {
		if (features.length === 0) return;

		const elements: string[] = [];

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;

			const sprite = spriteAtlas.get(style.image);
			if (!sprite) continue;

			// The pipeline places each symbol: its feature is a single point.
			const point = feature.geometry[0]?.[0];
			if (!point) continue;

			// Each piece of the sprite image: moved to its place, scaled from the image's size.
			const pieces = iconQuads(style, sprite).map((quad) => {
				const [x, y] = roundXY(point.x + quad.left, point.y + quad.top);
				const scaleX = (quad.right - quad.left) / quad.source.width;
				const scaleY = (quad.bottom - quad.top) / quad.source.height;
				const scale =
					formatScale(scaleX) === formatScale(scaleY)
						? scaleX === 1
							? ''
							: ` scale(${formatScale(scaleX)})`
						: ` scale(${formatScale(scaleX)},${formatScale(scaleY)})`;
				return {
					symbolId: this.#defs.spriteSymbol(style.image, sprite, quad.source),
					transform: `translate(${formatNum(x)},${formatNum(y)})${scale}`,
				};
			});

			const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';

			// SDF filter for colorable icons
			const filterAttr = style.sdf
				? ` filter="url(#${this.#defs.sdfFilter(new Color(style.color), new Color(style.haloColor), style.haloWidth)})"`
				: '';

			// One piece is placed by its group; several share the group's opacity and filter.
			const icon =
				pieces.length === 1
					? `<g transform="${pieces[0]!.transform}"${opacityAttr}${filterAttr}>` +
						`<use xlink:href="#${escapeXml(pieces[0]!.symbolId)}" />` +
						`</g>`
					: `<g${opacityAttr}${filterAttr}>` +
						pieces
							.map(
								({ symbolId, transform }) =>
									`<use xlink:href="#${escapeXml(symbolId)}" transform="${transform}" />`,
							)
							.join('') +
						`</g>`;
			if (style.rotate !== 0) {
				// As in MapLibre, `icon-rotate` turns the icon, offset included, around its point.
				const [cx, cy] = roundXY(point.x, point.y);
				elements.push(
					`<g transform="rotate(${String(style.rotate)},${formatNum(cx)},${formatNum(cy)})">${icon}</g>`,
				);
			} else {
				elements.push(icon);
			}
		}

		if (elements.length === 0) return;

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		this.#svg.push(...elements);
		this.#svg.push('</g>');
	}

	public drawRasterTiles(id: string, tiles: RasterTile[], style: RasterStyle): void {
		if (tiles.length === 0) return;
		if (style.opacity <= 0) return;

		const filters: string[] = [];
		if (style.hueRotate !== 0) filters.push(`hue-rotate(${String(style.hueRotate)}deg)`);
		if (style.saturation !== 0) filters.push(`saturate(${String(style.saturation + 1)})`);
		if (style.contrast !== 0) filters.push(`contrast(${String(style.contrast + 1)})`);
		if (style.brightnessMin !== 0 || style.brightnessMax !== 1) {
			const brightness = (style.brightnessMin + style.brightnessMax) / 2;
			filters.push(`brightness(${String(brightness)})`);
		}

		let gAttrs = `id="${escapeXml(id)}" opacity="${String(style.opacity)}"`;
		if (filters.length > 0) gAttrs += ` filter="${filters.join(' ')}"`;

		this.#svg.push(`<g ${gAttrs}>`);

		const pixelated = style.resampling === 'nearest';
		this.#drawRasterMeshes(tiles, pixelated);
		for (const tile of tiles) {
			if (tile.triangles) continue;
			const overlap = Math.min(tile.width, tile.height) / 10000; // slight overlap to prevent sub-pixel gaps between tiles
			let attrs = `x="${formatScaled(tile.x - overlap)}" y="${formatScaled(tile.y - overlap)}" width="${formatScaled(tile.width + overlap * 2)}" height="${formatScaled(tile.height + overlap * 2)}" xlink:href="${tile.dataUri}"`;
			if (pixelated) attrs += ' style="image-rendering:pixelated"';
			this.#svg.push(`<image ${attrs} />`);
		}

		this.#svg.push('</g>');
	}

	/**
	 * Draws raster tiles given as meshes of triangles (globe projection). Every tile image is
	 * defined once (as a square of RASTER_TILE_UNITS); every triangle shows it through the affine
	 * transform that maps its three source corners exactly onto its three screen corners, clipped
	 * to the triangle on screen.
	 *
	 * Seams: within a tile, each clip triangle is grown by RASTER_TRIANGLE_OVERLAP_PX; the same
	 * transform continues there, so the overlap shows (almost) the same pixels as the neighbour.
	 * At tile borders that is not enough, as both images end on the same line and their anti-
	 * aliased edges let a hairline of the background shine through. So first, as an underlay,
	 * the triangles along the tile borders are drawn with their image reaching beyond the border
	 * (see {@link bleedAtTileBorder}); then all triangles are drawn exactly on top of it. The
	 * slightly shifted underlay only shows through the seam.
	 */
	#drawRasterMeshes(tiles: RasterTile[], pixelated: boolean): void {
		const meshes: { imageId: string; triangles: RasterTriangle[]; standalone: boolean }[] = [];
		for (const tile of tiles) {
			if (!tile.triangles) continue;
			const imageId = this.#defs.rasterImage(tile.dataUri, RASTER_TILE_UNITS, pixelated);
			meshes.push({ imageId, triangles: tile.triangles, standalone: tile.standalone === true });
		}

		for (const { imageId, triangles, standalone } of meshes) {
			if (standalone) continue;
			for (const { source, target } of triangles) {
				if (!isOnTileBorder(source)) continue;
				this.#drawRasterTriangle(imageId, bleedAtTileBorder(source, target), target);
			}
		}
		for (const { imageId, triangles } of meshes) {
			for (const { source, target } of triangles) {
				this.#drawRasterTriangle(imageId, source, target);
			}
		}
	}

	#drawRasterTriangle(imageId: string, source: Triangle, target: Triangle): void {
		const matrix = affineFromTriangles(source, target);
		if (!matrix) return;
		const clip = growTriangle(target, RASTER_TRIANGLE_OVERLAP_PX);
		const clipId = `raster-clip-${String(this.#rasterClipCount++)}`;
		const d = segmentsToPath([clip.map(([x, y]) => roundXY(x, y))], true);
		this.#svg.push(
			`<clipPath id="${clipId}"><path d="${d}"/></clipPath>` +
				`<g clip-path="url(#${clipId})"><use xlink:href="#${imageId}" transform="matrix(${matrix.map(formatUnit).join(',')})" /></g>`,
		);
	}

	public getString(): string {
		const w = this.width.toFixed(0);
		const h = this.height.toFixed(0);

		const parts = [
			`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
			this.#defs.toString(w, h, this.#clipCircle),
			`<g id="map" clip-path="url(#vb)">`,
		];
		parts.push(...this.#svg, '</g>', '</svg>');
		return parts.join('\n');
	}
}
