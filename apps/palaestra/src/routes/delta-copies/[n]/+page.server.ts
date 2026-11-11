// How many copies of the same island the page shows (e2e/delta-copy-count.spec.ts).
export const load = ({ params }: { params: { n: string } }) => ({
	copies: Math.max(0, Math.min(5, Number(params.n) || 0))
});
