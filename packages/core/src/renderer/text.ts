/** The CSS font family of a label in `font`, the style's font stack, with fallbacks. */
export function fontFamily(font: string[]): string {
	return font.join(', ') + ', Helvetica, Arial, sans-serif';
}
