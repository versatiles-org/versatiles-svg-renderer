/**
 * Labels set vertically, as MapLibre GL JS sets a label with Chinese, Japanese or Korean along
 * a line that runs more up and down than across (`shaping.ts`, `tagged_string.ts`): which of
 * its characters stand upright, and its punctuation in the forms vertical text uses.
 */

/**
 * The characters that stand upright in vertical text (MapLibre's
 * `codePointHasUprightVerticalOrientation`): ideographs, kana, Hangul, Yi, Canadian syllabics,
 * full-width and vertical forms, emoji and other symbols.
 */
const UPRIGHT =
	// eslint-disable-next-line no-misleading-character-class -- it is tested on single code points
	/[\u02EA\u02EB\u1100-\u11FF\u1401-\u167F\u18B0-\u18FF\u2065\u20DD-\u20E0\u20E2-\u20E4\u2B97\u2BF0-\u2BFF\u2E50\u2E51\u2E80-\u3007\u3012\u3013\u3020-\u302F\u3031-\u30FB\u30FD-\uA4CF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE10-\uFE1F\uFE30-\uFE48\uFE50-\uFE57\uFE5F-\uFE62\uFE67-\uFE6F\uFF00-\uFF07\uFF0A-\uFF0C\uFF0E-\uFF19\uFF1F-\uFF3A\uFF3C\uFF3E\uFF40-\uFF5A\uFFE0-\uFFE2\uFFE4-\uFFE7\uFFF0-\uFFF8]|\uD802[\uDD80-\uDD9F]|\uD805[\uDD80-\uDDFF]|\uD806[\uDE00-\uDEBF]|[\uD80C-\uD810\uD81C-\uD822\uD83C\uD83D\uD840-\uD87E\uD880-\uD8BE][\uDC00-\uDFFF]|\uD811[\uDC00-\uDE7F]|\uD81B[\uDFE0-\uDFFF]|\uD823[\uDC00-\uDDFF]|\uD82B[\uDFF0-\uDFFF]|\uD82C[\uDC00-\uDEFF]|\uD833[\uDEC0-\uDFCF]|\uD834[\uDC00-\uDDFF\uDEE0-\uDF7F]|\uD836[\uDC00-\uDEAF]|\uD83E[\uDD00-\uDEFF]|[\uD87F\uD8BF][\uDC00-\uDFFD]/;

/**
 * The characters that stand upright or lie on their side as their neighbours do (MapLibre's
 * `codePointHasNeutralVerticalOrientation`).
 */
const NEUTRAL =
	/[\xA7\xA9\xAE\xB1\xBC-\xBE\xD7\xF7\u2016\u2020\u2021\u2030\u2031\u203B\u203C\u2042\u2047-\u2049\u2051\u2100-\u218F\u221E\u2234\u2235\u2300-\u2307\u230C-\u231F\u2324-\u2328\u232B\u237D-\u239A\u23BE-\u23CD\u23CF\u23D1-\u23DB\u23E2-\u2422\u2424-\u24FF\u25A0-\u2619\u2620-\u2767\u2776-\u2793\u2B12-\u2B2F\u2B50-\u2B59\u2BB8-\u2BEB\u3000-\u303F\u30A0-\u30FF\uE000-\uF8FF\uFE30-\uFE6F\uFF00-\uFFEF\uFFFC\uFFFD]|[\uDB80-\uDBFF][\uDC00-\uDFFF]/;

const DIGIT = /\p{Nd}/u;
const UPPERCASE = /\p{Lu}/u;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]/u;
const WHITE_SPACE = /\s/u;
const ARABIC = /\p{sc=Arab}/u;

/** Punctuation and symbols in the forms vertical text uses (MapLibre's `verticalizedCharacterMap`). */
const VERTICAL_FORMS = new Map(
	Object.entries({
		'!': '︕',
		'#': '＃',
		$: '＄',
		'%': '％',
		'&': '＆',
		'(': '︵',
		')': '︶',
		'*': '＊',
		'+': '＋',
		',': '︐',
		'-': '︲',
		'.': '・',
		'/': '／',
		':': '︓',
		';': '︔',
		'<': '︿',
		'=': '＝',
		'>': '﹀',
		'?': '︖',
		'@': '＠',
		'[': '﹇',
		'\\': '＼',
		']': '﹈',
		'^': '＾',
		_: '︳',
		'`': '｀',
		'{': '︷',
		'|': '―',
		'}': '︸',
		'~': '～',
		'¢': '￠',
		'£': '￡',
		'¥': '￥',
		'¦': '￤',
		'¬': '￢',
		'¯': '￣',
		'–': '︲',
		'—': '︱',
		'‘': '﹃',
		'’': '﹄',
		'“': '﹁',
		'”': '﹂',
		'…': '︙',
		'⋯': '︙',
		'‧': '・',
		'₩': '￦',
		'、': '︑',
		'。': '︒',
		'〈': '︿',
		'〉': '﹀',
		'《': '︽',
		'》': '︾',
		'「': '﹁',
		'」': '﹂',
		'『': '﹃',
		'』': '﹄',
		'【': '︻',
		'】': '︼',
		'〔': '︹',
		'〕': '︺',
		'〖': '︗',
		'〗': '︘',
		'！': '︕',
		'（': '︵',
		'）': '︶',
		'，': '︐',
		'－': '︲',
		'．': '・',
		'：': '︓',
		'；': '︔',
		'＜': '︿',
		'＞': '﹀',
		'？': '︖',
		'［': '﹇',
		'］': '﹈',
		'＿': '︳',
		'｛': '︷',
		'｜': '―',
		'｝': '︸',
		'｟': '︵',
		'｠': '︶',
		'｡': '︒',
		'｢': '﹁',
		'｣': '﹂',
	}),
);

/** A grapheme's first code point, by which MapLibre judges it. */
const first = (grapheme: string): string => String.fromCodePoint(grapheme.codePointAt(0)!);

const isUpright = (grapheme: string): boolean => UPRIGHT.test(first(grapheme));

/** Whether a grapheme lies on its side in vertical text, whatever its neighbours. */
const isSideways = (grapheme: string): boolean =>
	!isUpright(grapheme) && !NEUTRAL.test(first(grapheme));

/** Whether MapLibre would set `text` vertically: if any of its characters stands upright. */
export function allowsVerticalWritingMode(text: string): boolean {
	for (const char of text) if (UPRIGHT.test(char)) return true;
	return false;
}

/**
 * Whether a run of graphemes that would lie on their side stands upright instead, as MapLibre's
 * `runIsUpright`: a number, maybe with symbols ("21", "1-2"), or a code of up to three capitals
 * and digits ("JR", "A1"); longer runs of capitals are words, read better on their side.
 */
function runIsUpright(run: string[]): boolean {
	const chars = run.map(first);
	const isNumber =
		chars.some((char) => DIGIT.test(char)) &&
		chars.every((char) => DIGIT.test(char) || PUNCTUATION_OR_SYMBOL.test(char));
	const isCode =
		chars.length <= 3 && chars.every((char) => UPPERCASE.test(char) || DIGIT.test(char));
	return isNumber || isCode;
}

/** A label's graphemes set vertically: as drawn, and whether each stands upright. */
export interface VerticalText {
	chars: string[];
	upright: boolean[];
}

/**
 * The graphemes `chars` of a label set vertically, as MapLibre sets them without fonts of its
 * own (`font-faces`): punctuation and symbols in their vertical forms where neither neighbour
 * lies on its side; upright what always stands upright (ideographs, kana, Hangul), the digits
 * and capitals of numbers and short codes, and punctuation between upright characters; on its
 * side everything else (words in Latin letters, white space).
 */
export function verticalText(chars: readonly string[]): VerticalText {
	const besideSideways = (grapheme: string | undefined): boolean =>
		grapheme !== undefined && isSideways(grapheme) && !VERTICAL_FORMS.has(grapheme);
	const drawn = chars.map((char, i) =>
		besideSideways(chars[i - 1]) || besideSideways(chars[i + 1])
			? char
			: (VERTICAL_FORMS.get(char) ?? char),
	);

	const upright = drawn.map(isUpright);
	const inRun = (i: number): boolean => !upright[i] && !WHITE_SPACE.test(drawn[i]!);
	for (let start = 0; start < drawn.length; start++) {
		if (!inRun(start)) continue;
		let end = start;
		while (end + 1 < drawn.length && inRun(end + 1)) end++;
		if (runIsUpright(drawn.slice(start, end + 1))) {
			for (let i = start; i <= end; i++) {
				const char = first(drawn[i]!);
				upright[i] = (DIGIT.test(char) || UPPERCASE.test(char)) && !ARABIC.test(char);
			}
		}
		start = end;
	}

	// Punctuation left on its side between upright characters stands upright, in its vertical form.
	for (let i = 0; i < drawn.length; i++) {
		const form = upright[i] ? undefined : VERTICAL_FORMS.get(drawn[i]!);
		if (form && (i === 0 || upright[i - 1]) && (i === drawn.length - 1 || upright[i + 1])) {
			upright[i] = true;
			drawn[i] = form;
		}
	}
	return { chars: drawn, upright };
}
