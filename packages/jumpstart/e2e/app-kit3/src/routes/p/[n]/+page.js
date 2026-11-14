export function load({ params }) {
	return { n: Number(params.n) || 1 };
}
