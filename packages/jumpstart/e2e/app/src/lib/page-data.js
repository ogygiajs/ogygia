export function page_blocks(n, names) {
	let a = (n * 2654435761) >>> 0 || 1;
	const r = () => {
		a ^= a << 13;
		a ^= a >>> 17;
		a ^= a << 5;
		return (a >>> 0) / 4294967296;
	};
	const count = 3 + Math.floor(r() * 4);
	return Array.from({ length: count }, (_, b) => ({
		type: names[Math.floor(r() * names.length)],
		title: `Section ${b + 1} of page ${n}`,
		items: Array.from({ length: 2 + Math.floor(r() * 3) }, (_, k) => ({
			title: `Item ${k}`,
			n: n * 10 + k
		}))
	}));
}
