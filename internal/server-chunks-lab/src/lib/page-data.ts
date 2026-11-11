/** The blocks of page `n`: 5 to 9 of them, picked the same way every time (a CMS page's tree). */
import type { Item } from './types.ts';

export interface BlockData {
	type: string;
	title: string;
	items: Item[];
}

export function page_blocks(n: number, names: readonly string[]): BlockData[] {
	let a = (n * 2654435761) >>> 0 || 1;
	const r = (): number => {
		a ^= a << 13;
		a ^= a >>> 17;
		a ^= a << 5;
		return (a >>> 0) / 4294967296;
	};
	const count = 5 + Math.floor(r() * 5);
	return Array.from({ length: count }, (_, b) => ({
		type: names[Math.floor(r() * names.length)]!,
		title: 'Section ' + (b + 1) + ' of page ' + n,
		items: Array.from({ length: 3 + Math.floor(r() * 4) }, (_, k) => ({
			title: 'Item ' + k + ' about ' + ['pricing', 'support', 'shipping', 'returns'][k % 4],
			body: '**Bold** claim ' + k + ' with a [link](/p/' + k + ') and `code`.',
			date: '2026-10-' + String(1 + ((n + k) % 28)).padStart(2, '0'),
			n: n * 10 + k,
			items: ['a', 'b', 'c'].slice(0, 1 + (k % 3))
		}))
	}));
}
