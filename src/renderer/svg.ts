import type { Feature } from '../geometry.js';
import { Color } from './color.js';
import type { Segment } from './svg_path.js';
import { chainSegments, formatNum, offsetSegmentPoints, segmentsToPath } from './svg_path.js';
import type {
	BackgroundStyle,
	CircleStyle,
	FillStyle,
	IconStyle,
	LineStyle,
	RasterStyle,
	RasterTile,
	RendererOptions,
	SymbolStyle as LabelStyle,
} from './types.js';
import type { SpriteAtlas } from '../sources/sprite.js';

export type {
	BackgroundStyle,
	CircleStyle,
	FillStyle,
	IconStyle,
	LineStyle,
	RasterStyle,
	RasterTile,
	Renderer,
	RenderJob,
	RendererOptions,
	SymbolStyle,
	View,
} from './types.js';

export class SVGRenderer {
	public readonly width: number;

	public readonly height: number;

	readonly #svg: string[];

	#backgroundColor: Color;

	readonly #spriteSheetDefs = new Map<
		string,
		{ defId: string; width: number; height: number; href: string }
	>();

	readonly #spriteSymbolDefs = new Map<
		string,
		{ symbolId: string; sheetDefId: string; x: number; y: number; width: number; height: number }
	>();

	readonly #sdfFilterDefs = new Map<string, { filterId: string; content: string }>();
	readonly #blurFilterDefs = new Map<string, { filterId: string; stdDev: string }>();

	public constructor(opt: RendererOptions) {
		this.width = opt.width;
		this.height = opt.height;
		this.#svg = [];
		this.#backgroundColor = Color.transparent;
	}

	public drawBackgroundFill(style: BackgroundStyle): void {
		const color = new Color(style.color);
		color.alpha *= style.opacity;
		this.#backgroundColor = color;
	}

	public drawPolygons(id: string, features: [Feature, FillStyle][]): void {
		if (features.length === 0) return;

		const groups = new Map<string, { segments: Segment[]; attrs: string }>();
		features.forEach(([feature, style]) => {
			if (style.opacity <= 0) return;
			const color = new Color(style.color);
			if (color.alpha <= 0) return;

			const translate =
				style.translate[0] === 0 && style.translate[1] === 0
					? ''
					: ` transform="translate(${formatPoint(style.translate)})"`;
			const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';
			const key = color.hex + translate + opacityAttr;

			let group = groups.get(key);
			if (!group) {
				group = { segments: [], attrs: `${fillAttr(color)}${translate}${opacityAttr}` };
				groups.set(key, group);
			}
			feature.geometry.forEach((ring) => {
				group.segments.push(ring.map((p) => roundXY(p.x, p.y)));
			});
		});

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const { segments, attrs } of groups.values()) {
			const d = segmentsToPath(segments, true);
			this.#svg.push(`<path d="${d}" ${attrs} />`);
		}
		this.#svg.push('</g>');
	}

	public drawLineStrings(id: string, features: [Feature, LineStyle][]): void {
		if (features.length === 0) return;

		const groups = new Map<string, { segments: Segment[]; attrs: string }>();
		features.forEach(([feature, style]) => {
			if (style.opacity <= 0) return;
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
			const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';
			const filterAttr = style.blur > 0 ? ` filter="url(#${this.#blurFilterId(style.blur)})"` : '';
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

			let group = groups.get(key);
			if (!group) {
				const attrs = [
					'fill="none"',
					strokeAttr(color, roundedWidth),
					`stroke-linecap="${style.cap}"`,
					`stroke-linejoin="${style.join}"`,
					`stroke-miterlimit="${String(style.miterLimit)}"`,
				];
				if (dasharrayStr) attrs.push(`stroke-dasharray="${dasharrayStr}"`);
				group = {
					segments: [],
					attrs: attrs.join(' ') + translate + opacityAttr + filterAttr,
				};
				groups.set(key, group);
			}

			feature.geometry.forEach((line) => {
				const points = style.offset === 0 ? line : offsetSegmentPoints(line, style.offset);
				group.segments.push(points.map((p) => roundXY(p.x, p.y)));
			});
		});

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const { segments, attrs } of groups.values()) {
			const chains = chainSegments(segments);
			const d = segmentsToPath(chains);
			this.#svg.push(`<path d="${d}" ${attrs} />`);
		}
		this.#svg.push('</g>');
	}

	/** Register (deduplicated by blur radius) a Gaussian blur filter and return its id. */
	#blurFilterId(blur: number): string {
		const stdDev = formatScaled(blur);
		let def = this.#blurFilterDefs.get(stdDev);
		if (!def) {
			def = { filterId: `line-blur-${String(this.#blurFilterDefs.size)}`, stdDev };
			this.#blurFilterDefs.set(stdDev, def);
		}
		return def.filterId;
	}

	public drawCircles(id: string, features: [Feature, CircleStyle][]): void {
		if (features.length === 0) return;

		const groups = new Map<string, { points: [number, number][]; attrs: string }>();
		features.forEach(([feature, style]) => {
			if (style.opacity <= 0) return;
			const color = new Color(style.color);
			if (style.radius <= 0 || color.alpha <= 0) return;

			const translate =
				style.translate[0] === 0 && style.translate[1] === 0
					? ''
					: ` transform="translate(${formatPoint(style.translate)})"`;
			const roundedRadius = formatScaled(style.radius);
			const strokeColor = new Color(style.strokeColor);
			const strokeAttrs =
				style.strokeWidth > 0 ? ` ${strokeAttr(strokeColor, formatScaled(style.strokeWidth))}` : '';
			const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';
			const key = [color.hex, roundedRadius, strokeAttrs, opacityAttr, translate].join('\0');

			let group = groups.get(key);
			if (!group) {
				group = {
					points: [],
					attrs: `r="${roundedRadius}" ${fillAttr(color)}${strokeAttrs}${translate}${opacityAttr}`,
				};
				groups.set(key, group);
			}
			feature.geometry.forEach((ring) => {
				const p = ring[0];
				if (p) group.points.push(roundXY(p.x, p.y));
			});
		});

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const { points, attrs } of groups.values()) {
			for (const [x, y] of points) {
				this.#svg.push(`<circle cx="${formatNum(x)}" cy="${formatNum(y)}" ${attrs} />`);
			}
		}
		this.#svg.push('</g>');
	}

	public drawLabels(id: string, features: [Feature, LabelStyle][]): void {
		if (features.length === 0) return;

		this.#svg.push(`<g id="${escapeXml(id)}">`);
		for (const [feature, style] of features) {
			if (style.opacity <= 0 || !style.text) continue;

			const color = new Color(style.color);
			if (color.alpha <= 0) continue;

			const ring = feature.geometry[0];
			if (!ring || ring.length === 0) continue;
			const point = ring[Math.floor(ring.length / 2)]!;
			const [px, py] = roundXY(point.x, point.y);

			const fontSize = formatScaled(style.size);
			const fontFamily = style.font.join(', ') + ', Helvetica, Arial, sans-serif';
			const [svgAnchor, baseline] = mapTextAnchor(style.anchor);

			const offsetX = style.offset[0] * style.size;
			const offsetY = style.offset[1] * style.size;
			const [dx, dy] = roundXY(offsetX, offsetY);

			const attrs: string[] = [
				`x="${formatNum(px)}"`,
				`y="${formatNum(py)}"`,
				`font-family="${escapeXml(fontFamily)}"`,
				`font-size="${fontSize}"`,
				`text-anchor="${svgAnchor}"`,
				`dominant-baseline="${baseline}"`,
			];

			if (dx !== 0) attrs.push(`dx="${formatNum(dx)}"`);
			if (dy !== 0) attrs.push(`dy="${formatNum(dy)}"`);

			if (style.rotate !== 0) {
				attrs.push(`transform="rotate(${String(style.rotate)},${formatNum(px)},${formatNum(py)})"`);
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

			this.#svg.push(`<text ${attrs.join(' ')}>${escapeXml(style.text)}</text>`);
		}
		this.#svg.push('</g>');
	}

	public drawIcons(id: string, features: [Feature, IconStyle][], spriteAtlas: SpriteAtlas): void {
		if (features.length === 0) return;

		const elements: string[] = [];

		for (const [feature, style] of features) {
			if (style.opacity <= 0) continue;

			const sprite = spriteAtlas.get(style.image);
			if (!sprite) continue;

			const ring = feature.geometry[0];
			if (!ring || ring.length === 0) continue;
			const point = ring[Math.floor(ring.length / 2)]!;

			const scale = style.size / sprite.pixelRatio;
			const iconW = sprite.width * scale;
			const iconH = sprite.height * scale;

			const [anchorDx, anchorDy] = mapIconAnchor(style.anchor, iconW, iconH);
			const ox = style.offset[0] * style.size + anchorDx;
			const oy = style.offset[1] * style.size + anchorDy;

			const [iconXr, iconYr] = roundXY(point.x + ox, point.y + oy);

			// Register sprite sheet in global defs (once per unique data URI)
			const imgW = Math.round(sprite.sheetWidth * 10);
			const imgH = Math.round(sprite.sheetHeight * 10);
			const sheetKey = sprite.sheetDataUri;
			if (!this.#spriteSheetDefs.has(sheetKey)) {
				this.#spriteSheetDefs.set(sheetKey, {
					defId: `sprite-sheet-${String(this.#spriteSheetDefs.size)}`,
					width: imgW,
					height: imgH,
					href: sprite.sheetDataUri,
				});
			}
			const sheetDef = this.#spriteSheetDefs.get(sheetKey)!;

			// Register symbol for this sprite (once per sprite name + sheet)
			const sprX = Math.round(sprite.x * 10);
			const sprY = Math.round(sprite.y * 10);
			const sprW = Math.round(sprite.width * 10);
			const sprH = Math.round(sprite.height * 10);
			const symKey = `${style.image}\0${sheetKey}`;
			if (!this.#spriteSymbolDefs.has(symKey)) {
				this.#spriteSymbolDefs.set(symKey, {
					symbolId: `sprite-${escapeXml(style.image)}`,
					sheetDefId: sheetDef.defId,
					x: sprX,
					y: sprY,
					width: sprW,
					height: sprH,
				});
			}
			const symDef = this.#spriteSymbolDefs.get(symKey)!;

			// Build instance: translate to position, scale from native to desired size
			const scaleStr = scale === 1 ? '' : ` scale(${formatScale(scale)})`;
			const opacityAttr = style.opacity < 1 ? ` opacity="${style.opacity.toFixed(3)}"` : '';

			// SDF filter for colorable icons
			let filterAttr = '';
			if (style.sdf) {
				const iconColor = new Color(style.color);
				const haloColor = new Color(style.haloColor);
				const hasHalo = style.haloWidth > 0 && haloColor.alpha > 0;
				const filterKey = hasHalo
					? `sdf\0${iconColor.hex}\0${haloColor.hex}\0${String(style.haloWidth)}`
					: `sdf\0${iconColor.hex}`;

				if (!this.#sdfFilterDefs.has(filterKey)) {
					const filterId = `sdf-${String(this.#sdfFilterDefs.size)}`;
					const iconFloodOpacity =
						iconColor.alpha < 255 ? ` flood-opacity="${iconColor.opacity.toFixed(3)}"` : '';
					let content: string;
					if (hasHalo) {
						const haloRadius = formatScale(style.haloWidth);
						const haloFloodOpacity =
							haloColor.alpha < 255 ? ` flood-opacity="${haloColor.opacity.toFixed(3)}"` : '';
						content =
							`<filter id="${filterId}" color-interpolation-filters="sRGB">` +
							// Threshold alpha at 0.75 (MapLibre SDF edge) to get sharp icon mask
							`<feComponentTransfer in="SourceGraphic" result="sharp"><feFuncA type="discrete" tableValues="0 0 0 1" /></feComponentTransfer>` +
							// Dilate sharp mask for halo
							`<feMorphology in="sharp" operator="dilate" radius="${haloRadius}" result="dilated" />` +
							`<feFlood flood-color="${haloColor.rgb}"${haloFloodOpacity} result="haloColor" />` +
							`<feComposite in="haloColor" in2="dilated" operator="in" result="halo" />` +
							// Color the sharp icon
							`<feFlood flood-color="${iconColor.rgb}"${iconFloodOpacity} result="iconColor" />` +
							`<feComposite in="iconColor" in2="sharp" operator="in" result="colored" />` +
							`<feComposite in="colored" in2="halo" operator="over" />` +
							`</filter>`;
					} else {
						content =
							`<filter id="${filterId}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">` +
							// Threshold alpha at 0.75 (MapLibre SDF edge) to get sharp mask
							`<feComponentTransfer in="SourceGraphic" result="sharp"><feFuncA type="discrete" tableValues="0 0 0 1" /></feComponentTransfer>` +
							// Replace color while keeping sharp alpha
							`<feFlood flood-color="${iconColor.rgb}"${iconFloodOpacity} result="color" />` +
							`<feComposite in="color" in2="sharp" operator="in" />` +
							`</filter>`;
					}
					this.#sdfFilterDefs.set(filterKey, { filterId, content });
				}
				const { filterId } = this.#sdfFilterDefs.get(filterKey)!;
				filterAttr = ` filter="url(#${filterId})"`;
			}

			if (style.rotate !== 0) {
				const [cx, cy] = roundXY(
					point.x + style.offset[0] * style.size,
					point.y + style.offset[1] * style.size,
				);
				elements.push(
					`<g transform="rotate(${String(style.rotate)},${formatNum(cx)},${formatNum(cy)})">` +
						`<g transform="translate(${formatNum(iconXr)},${formatNum(iconYr)})${scaleStr}"${opacityAttr}${filterAttr}>` +
						`<use xlink:href="#${escapeXml(symDef.symbolId)}" />` +
						`</g></g>`,
				);
			} else {
				elements.push(
					`<g transform="translate(${formatNum(iconXr)},${formatNum(iconYr)})${scaleStr}"${opacityAttr}${filterAttr}>` +
						`<use xlink:href="#${escapeXml(symDef.symbolId)}" />` +
						`</g>`,
				);
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
		for (const tile of tiles) {
			const overlap = Math.min(tile.width, tile.height) / 10000; // slight overlap to prevent sub-pixel gaps between tiles
			let attrs = `x="${formatScaled(tile.x - overlap)}" y="${formatScaled(tile.y - overlap)}" width="${formatScaled(tile.width + overlap * 2)}" height="${formatScaled(tile.height + overlap * 2)}" xlink:href="${tile.dataUri}"`;
			if (pixelated) attrs += ' style="image-rendering:pixelated"';
			this.#svg.push(`<image ${attrs} />`);
		}

		this.#svg.push('</g>');
	}

	public getString(): string {
		const w = this.width.toFixed(0);
		const h = this.height.toFixed(0);

		// Build defs content
		const defsContent = [`<clipPath id="vb"><rect width="${w}" height="${h}"/></clipPath>`];
		for (const sheet of this.#spriteSheetDefs.values()) {
			defsContent.push(
				`<image id="${escapeXml(sheet.defId)}" width="${formatNum(sheet.width)}" height="${formatNum(sheet.height)}" xlink:href="${escapeXml(sheet.href)}" />`,
			);
		}
		for (const sym of this.#spriteSymbolDefs.values()) {
			const clipId = `${sym.symbolId}-clip`;
			defsContent.push(
				`<clipPath id="${escapeXml(clipId)}"><rect width="${formatNum(sym.width)}" height="${formatNum(sym.height)}" /></clipPath>`,
				`<symbol id="${escapeXml(sym.symbolId)}"><g clip-path="url(#${escapeXml(clipId)})"><use xlink:href="#${escapeXml(sym.sheetDefId)}" x="${formatNum(-sym.x)}" y="${formatNum(-sym.y)}" /></g></symbol>`,
			);
		}
		for (const { content } of this.#sdfFilterDefs.values()) {
			defsContent.push(content);
		}
		for (const { filterId, stdDev } of this.#blurFilterDefs.values()) {
			defsContent.push(
				`<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${stdDev}" /></filter>`,
			);
		}

		const parts = [
			`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
			`<defs>\n  ${defsContent.join('\n  ')}\n</defs>`,
			`<g id="map" clip-path="url(#vb)">`,
		];
		if (this.#backgroundColor.alpha > 0) {
			parts.push(
				`<rect x="-1" y="-1" width="${(this.width + 2).toFixed(0)}" height="${(this.height + 2).toFixed(0)}" ${fillAttr(this.#backgroundColor)} />`,
			);
		}
		parts.push(...this.#svg, '</g>', '</svg>');
		return parts.join('\n');
	}
}

function fillAttr(color: Color): string {
	let attr = `fill="${color.rgb}"`;
	if (color.alpha < 255) attr += ` fill-opacity="${color.opacity.toFixed(3)}"`;
	return attr;
}

function strokeAttr(color: Color, width: string): string {
	let attr = `stroke="${color.rgb}" stroke-width="${width}"`;
	if (color.alpha < 255) attr += ` stroke-opacity="${color.opacity.toFixed(3)}"`;
	return attr;
}

function formatScaled(v: number): string {
	return formatNum(Math.round(v * 10));
}

function formatScale(v: number): string {
	return (Math.round(v * 10000) / 10000).toString();
}

function roundXY(x: number, y: number): [number, number] {
	return [Math.round(x * 10), Math.round(y * 10)];
}

function formatPoint(p: [number, number]): string {
	const [x, y] = roundXY(p[0], p[1]);
	return formatNum(x) + ',' + formatNum(y);
}

function mapTextAnchor(anchor: string): [string, string] {
	switch (anchor) {
		case 'left':
			return ['start', 'central'];
		case 'right':
			return ['end', 'central'];
		case 'top':
			return ['middle', 'text-before-edge'];
		case 'bottom':
			return ['middle', 'text-after-edge'];
		case 'top-left':
			return ['start', 'text-before-edge'];
		case 'top-right':
			return ['end', 'text-before-edge'];
		case 'bottom-left':
			return ['start', 'text-after-edge'];
		case 'bottom-right':
			return ['end', 'text-after-edge'];
		default:
			return ['middle', 'central'];
	}
}

function mapIconAnchor(anchor: string, w: number, h: number): [number, number] {
	switch (anchor) {
		case 'left':
			return [0, -h / 2];
		case 'right':
			return [-w, -h / 2];
		case 'top':
			return [-w / 2, 0];
		case 'bottom':
			return [-w / 2, -h];
		case 'top-left':
			return [0, 0];
		case 'top-right':
			return [-w, 0];
		case 'bottom-left':
			return [0, -h];
		case 'bottom-right':
			return [-w, -h];
		default:
			return [-w / 2, -h / 2];
	}
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
