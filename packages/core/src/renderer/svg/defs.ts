/**
 * The `<defs>` of an SVG: everything the drawing refers to by id, each defined once however
 * often it is used, such as sprite images, patterns, filters, gradients and glyph outlines.
 * Ids are numbered in the order things are first asked for, so the same drawing always gets
 * the same ids.
 */
import type { GlyphOutline, FillPattern, LinePattern } from '../../types.js';
import type { SpriteEntry } from '../../sources/index.js';
import type { ClipCircle } from '../../projection.js';
import type { Color } from '../color.js';
import type { CircleGradientStop } from '../circle.js';
import { escapeXml, formatNum, formatScale, formatScaled, formatUnit } from './format.js';

export class SvgDefs {
	readonly #spriteSheetDefs = new Map<
		string,
		{ defId: string; width: number; height: number; href: string }
	>();

	readonly #spriteSymbolDefs = new Map<
		string,
		{ symbolId: string; sheetDefId: string; x: number; y: number; width: number; height: number }
	>();

	readonly #sdfFilterDefs = new Map<string, { filterId: string; content: string }>();
	readonly #patternDefs = new Map<string, { id: string; content: string }>();
	/** Glyph outlines of labels drawn as glyphs, by their keys. */
	readonly #glyphDefs = new Map<string, { id: string; d: string }>();
	/** Radial gradients of blurred circles: their ids, by their stops. */
	readonly #circleGradientDefs = new Map<string, string>();
	readonly #blurFilterDefs = new Map<
		string,
		{ filterId: string; stdDev: string; alphaCurve: [number, number] }
	>();

	readonly #rasterDefs: string[] = [];

	/**
	 * The id of a `<symbol>` showing sprite image `name` at its native size, defined once:
	 * the sprite sheet goes into the defs once, and each image clips it.
	 */
	public spriteSymbol(
		name: string,
		sprite: SpriteEntry,
		source: { x: number; y: number; width: number; height: number } = sprite,
	): string {
		const sheetKey = sprite.sheetDataUri;
		let sheetDef = this.#spriteSheetDefs.get(sheetKey);
		if (!sheetDef) {
			sheetDef = {
				defId: `sprite-sheet-${String(this.#spriteSheetDefs.size)}`,
				width: Math.round(sprite.sheetWidth * 10),
				height: Math.round(sprite.sheetHeight * 10),
				href: sprite.sheetDataUri,
			};
			this.#spriteSheetDefs.set(sheetKey, sheetDef);
		}
		const x = Math.round(source.x * 10);
		const y = Math.round(source.y * 10);
		const width = Math.round(source.width * 10);
		const height = Math.round(source.height * 10);
		// The whole image, or a piece of it (see `iconQuads`).
		const whole =
			source.x === sprite.x &&
			source.y === sprite.y &&
			source.width === sprite.width &&
			source.height === sprite.height;
		const symKey = `${name}\0${sheetKey}\0${String(x)}\0${String(y)}\0${String(width)}\0${String(height)}`;
		let symDef = this.#spriteSymbolDefs.get(symKey);
		if (!symDef) {
			const piece = whole ? '' : `-${String(x)}-${String(y)}-${String(width)}-${String(height)}`;
			symDef = {
				symbolId: `sprite-${escapeXml(name)}${piece}`,
				sheetDefId: sheetDef.defId,
				x,
				y,
				width,
				height,
			};
			this.#spriteSymbolDefs.set(symKey, symDef);
		}
		return symDef.symbolId;
	}

	/**
	 * `url(#…)` of a `<pattern>` repeating the sprite image of `pattern` at its display size,
	 * with a copy's corner at `pattern.origin`: defined once per image and origin.
	 */
	public fillPattern(pattern: FillPattern): string {
		const { sprite, origin } = pattern;
		const scale = (pattern.scale ?? 1) / sprite.pixelRatio;
		const width = sprite.width * scale;
		const height = sprite.height * scale;
		// Only the origin's position within one copy matters.
		// Only the origin's position within one copy matters, unless the pattern turns around it.
		const angle = pattern.angle ?? 0;
		const x = angle === 0 ? mod(origin[0], width) : origin[0];
		const y = angle === 0 ? mod(origin[1], height) : origin[1];
		const key = [
			pattern.name,
			sprite.sheetDataUri,
			x.toFixed(2),
			y.toFixed(2),
			String(angle),
			formatScale(scale),
		].join('\0');
		let def = this.#patternDefs.get(key);
		if (!def) {
			const id = `pattern-${String(this.#patternDefs.size)}`;
			const symbolId = this.spriteSymbol(pattern.name, sprite);
			def = {
				id,
				content:
					`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${formatScaled(x)}" y="${formatScaled(y)}" width="${formatScaled(width)}" height="${formatScaled(height)}"${angle === 0 ? '' : ` patternTransform="rotate(${formatScale(angle)} ${formatScaled(x)} ${formatScaled(y)})"`}>` +
					`<use xlink:href="#${escapeXml(symbolId)}" transform="scale(${formatScale(scale)})" />` +
					`</pattern>`,
			};
			this.#patternDefs.set(key, def);
		}
		return `url(#${def.id})`;
	}

	/**
	 * `url(#…)` of a `<pattern>` repeating the sprite image of `pattern` along a line of
	 * `width`: one copy per `period` along it, spanning its width (see `linePatternStrips`).
	 */
	public linePattern(pattern: LinePattern, width: number): string {
		const { sprite, period } = pattern;
		const key = [
			'line',
			pattern.name,
			sprite.sheetDataUri,
			formatUnit(period),
			formatUnit(width),
		].join('\0');
		let def = this.#patternDefs.get(key);
		if (!def) {
			const id = `pattern-${String(this.#patternDefs.size)}`;
			const symbolId = this.spriteSymbol(pattern.name, sprite);
			const scale = `${formatScale(period / sprite.width)},${formatScale(width / sprite.height)}`;
			def = {
				id,
				content:
					`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${formatUnit(period)}" height="${formatUnit(width)}">` +
					`<use xlink:href="#${escapeXml(symbolId)}" transform="scale(${scale})" />` +
					`</pattern>`,
			};
			this.#patternDefs.set(key, def);
		}
		return `url(#${def.id})`;
	}

	/**
	 * The id of a Gaussian blur filter of `stdDev`, defined once per `stdDev`, whose alpha is
	 * then steepened by `alphaCurve` (slope, intercept).
	 */
	public blurFilter(stdDev: string, alphaCurve: [number, number]): string {
		let def = this.#blurFilterDefs.get(stdDev);
		if (!def) {
			def = { filterId: `line-blur-${String(this.#blurFilterDefs.size)}`, stdDev, alphaCurve };
			this.#blurFilterDefs.set(stdDev, def);
		}
		return def.filterId;
	}

	/**
	 * The id of a `<radialGradient>` for a blurred circle's `stops`, defined once per look.
	 */
	public circleGradient(stops: CircleGradientStop[]): string {
		const content = stops
			.map((stop) => {
				const [r, g, b] = stop.rgb.map((c) => Math.round(c));
				return `<stop offset="${formatScale(stop.offset)}" stop-color="rgb(${String(r)},${String(g)},${String(b)})" stop-opacity="${formatScale(stop.opacity)}" />`;
			})
			.join('');
		let id = this.#circleGradientDefs.get(content);
		if (!id) {
			id = `circle-blur-${String(this.#circleGradientDefs.size)}`;
			this.#circleGradientDefs.set(content, id);
		}
		return id;
	}

	/** The id of a glyph's outline, defined once. */
	public glyph(outline: GlyphOutline): string {
		let id = this.#glyphDefs.get(outline.key)?.id;
		if (!id) {
			id = `glyph-${String(this.#glyphDefs.size)}`;
			const d = outline.rings
				.map((ring) => 'M' + ring.map(([x, y]) => `${String(x)},${String(y)}`).join('L') + 'Z')
				.join('');
			this.#glyphDefs.set(outline.key, { id, d });
		}
		return id;
	}

	/**
	 * The id of a filter that colours an SDF icon with `iconColor` and, with a `haloWidth`,
	 * gives it a halo in `haloColor`: defined once per look.
	 */
	public sdfFilter(iconColor: Color, haloColor: Color, haloWidth: number): string {
		const hasHalo = haloWidth > 0 && haloColor.alpha > 0;
		const filterKey = hasHalo
			? `sdf\0${iconColor.hex}\0${haloColor.hex}\0${String(haloWidth)}`
			: `sdf\0${iconColor.hex}`;

		if (!this.#sdfFilterDefs.has(filterKey)) {
			const filterId = `sdf-${String(this.#sdfFilterDefs.size)}`;
			const iconFloodOpacity =
				iconColor.alpha < 255 ? ` flood-opacity="${iconColor.opacity.toFixed(3)}"` : '';
			let content: string;
			if (hasHalo) {
				const haloRadius = formatScale(haloWidth);
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
		return this.#sdfFilterDefs.get(filterKey)!.filterId;
	}

	/**
	 * The id of a raster tile's image, a square of `size` units, for the triangles of a
	 * mesh to show through their transforms.
	 */
	public rasterImage(dataUri: string, size: number, pixelated: boolean): string {
		const imageId = `raster-${String(this.#rasterDefs.length)}`;
		const units = String(size);
		let imageAttrs = `id="${imageId}" width="${units}" height="${units}" preserveAspectRatio="none" xlink:href="${dataUri}"`;
		if (pixelated) imageAttrs += ' style="image-rendering:pixelated"';
		this.#rasterDefs.push(`<image ${imageAttrs} />`);
		return imageId;
	}

	/**
	 * The `<defs>` element: first the clip path `vb` of the map, `width` × `height` or the
	 * globe's `clipCircle`, then everything defined.
	 */
	public toString(width: string, height: string, clipCircle: ClipCircle | undefined): string {
		const clipShape = clipCircle
			? `<circle cx="${formatUnit(clipCircle.x)}" cy="${formatUnit(clipCircle.y)}" r="${formatUnit(clipCircle.radius)}"/>`
			: `<rect width="${width}" height="${height}"/>`;
		const defsContent = [`<clipPath id="vb">${clipShape}</clipPath>`, ...this.#rasterDefs];
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
		for (const { content } of this.#patternDefs.values()) {
			defsContent.push(content);
		}
		for (const { id, d } of this.#glyphDefs.values()) {
			defsContent.push(`<path id="${id}" fill-rule="evenodd" d="${d}" />`);
		}
		for (const [stops, id] of this.#circleGradientDefs) {
			defsContent.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
		}
		for (const { filterId, stdDev, alphaCurve } of this.#blurFilterDefs.values()) {
			// Use userSpaceOnUse over the whole canvas: the default objectBoundingBox
			// region collapses to zero for axis-aligned lines (a horizontal/vertical
			// path has a zero-height/width bounding box), which clips the blur away.
			// feGaussianBlur softens the line, then feComponentTransfer steepens the
			// alpha to clip the Gaussian tails toward MapLibre's hard-edged feather.
			const [slope, intercept] = alphaCurve;
			defsContent.push(
				`<filter id="${filterId}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
					`<feGaussianBlur stdDeviation="${stdDev}" />` +
					`<feComponentTransfer><feFuncA type="linear" slope="${String(slope)}" intercept="${String(intercept)}" /></feComponentTransfer>` +
					`</filter>`,
			);
		}
		return `<defs>\n  ${defsContent.join('\n  ')}\n</defs>`;
	}
}

/** `value` modulo `period`, always in `[0, period)`. */
function mod(value: number, period: number): number {
	return ((value % period) + period) % period;
}
