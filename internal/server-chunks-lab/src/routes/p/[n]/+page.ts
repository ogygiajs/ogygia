export function load({ params }: { params: { n: string } }): { n: number } {
	return { n: Number(params.n) || 1 };
}
