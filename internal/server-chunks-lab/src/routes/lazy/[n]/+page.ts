// The CMS page with lazy blocks: only the blocks this page renders are imported, on first use.
// Universal load on a csr=false page runs on the server only, so it may return components.
import type { Component } from 'svelte';
import { loaders, LAZY_BLOCK_NAMES, type LazyBlockName } from '$lib/registry-lazy.ts';
import { page_blocks, type BlockData } from '$lib/page-data.ts';

export async function load({
	params,
	setHeaders
}: {
	params: { n: string };
	setHeaders: (h: Record<string, string>) => void;
}): Promise<{ n: number; blocks: (BlockData & { C: Component<never> })[] }> {
	const n = Number(params.n) || 1;
	const blocks = page_blocks(n, LAZY_BLOCK_NAMES);
	const modules = await Promise.all(blocks.map((b) => loaders[b.type as LazyBlockName]()));
	// (the bench counts how many blocks a page needed that no earlier page loaded)
	setHeaders({ 'x-blocks': blocks.map((b) => b.type).join(',') });
	return {
		n,
		blocks: blocks.map((b, i) => ({ ...b, C: modules[i]!.default as unknown as Component<never> }))
	};
}
