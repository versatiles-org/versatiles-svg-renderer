import type { Segment } from '../layout/index.js';

export function segmentsToPath(chains: Segment[], close = false): string {
	let d = '';
	for (const chain of chains) {
		const first = chain[0];
		if (!first) continue;
		d += 'M' + formatNum(first[0]) + ',' + formatNum(first[1]);
		let px = first[0];
		let py = first[1];
		for (let i = 1; i < chain.length; i++) {
			const x = chain[i]![0];
			const y = chain[i]![1];
			const dx = x - px;
			const dy = y - py;
			if (dy === 0) {
				const rel = 'h' + formatNum(dx);
				const abs = 'H' + formatNum(x);
				d += rel.length <= abs.length ? rel : abs;
			} else if (dx === 0) {
				const rel = 'v' + formatNum(dy);
				const abs = 'V' + formatNum(y);
				d += rel.length <= abs.length ? rel : abs;
			} else {
				const rel = 'l' + formatNum(dx) + ',' + formatNum(dy);
				const abs = 'L' + formatNum(x) + ',' + formatNum(y);
				d += rel.length <= abs.length ? rel : abs;
			}
			px = x;
			py = y;
		}
		if (close) d += 'z';
	}
	return d;
}

export function formatNum(tenths: number): string {
	if (tenths % 10 === 0) return String(tenths / 10);
	const negative = tenths < 0;
	if (negative) tenths = -tenths;
	const whole = Math.floor(tenths / 10);
	const frac = tenths % 10;
	return (negative ? '-' : '') + String(whole) + '.' + String(frac);
}
