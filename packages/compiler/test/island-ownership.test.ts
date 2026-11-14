/**
 * REGRESSION — island-transform ownership (the csr=false + `render:'deferred'` prerender crash).
 *
 * The rule: the markup preprocessor island-transforms CONTENT files (`.svx`/`.md`) ONLY. Islands in
 * a `.svelte` belong to the Vite plugin's transform hook, which runs BEFORE vite-plugin-svelte —
 * so by the time the markup hook sees a `.svelte`, marked imports are ALREADY rewritten. Running
 * the bridge there transformed the plugin's OUTPUT: a server island read as a plain component, its
 * `{#snippet}` children were branded as phantom portable snippets, and registering that phantom
 * WIPED the host's real wrapper registration — the cold build then failed to resolve
 * `ogygia:region/wrapper/<hash>.svelte` (client) or leaked it raw into the server bundle
 * (`ERR_UNSUPPORTED_ESM_URL_SCHEME: virtual:` at prerender).
 *
 * This file holds the compiler half (the server-island host legs). The markup-preprocessor half
 * (content files only, never a `.svelte`) lives with the content plugin:
 * packages/content/test/island-ownership.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { transformHost } from '../src/region/transform.ts';

// A csr=false route host: a marked server island with a fallback snippet child.
const ROUTE_HOST = `<script lang="ts">
	import DeferredHole from './DeferredHole.svelte' with { render: 'deferred' };
</script>

<DeferredHole>
	{#snippet ogygiaFallback()}<p>loading…</p>{/snippet}
</DeferredHole>
`;

// What the PLUGIN transform leaves behind on the csr=false client leg (mark consumed → stub import).
// This is the shape the markup hook actually receives for a `.svelte` — the phantom's trigger.
const PLUGIN_OUTPUT = ROUTE_HOST.replace(
	`import DeferredHole from './DeferredHole.svelte' with { render: 'deferred' };`,
	`import DeferredHole from 'ogygia:region/client-binding-stub';`
);

describe('server-island host legs (the compiler contract the registry depends on)', () => {
	const ctx = {
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_h: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
		devUrlFor: (p: string) => p,
		visibleMargin: '200px',
		presets: {},
		importKeys: {},
		idSalt: '',
		clientBindingStub: 'ogygia:region/client-binding-stub',
		routeCsr: undefined
	};
	const id = '/app/src/routes/demo/deferred/+page.svelte';

	it('SSR leg: wrapper import + island registered WITH wrapper source', () => {
		const r = transformHost(ROUTE_HOST, id, { ...ctx, ssr: true, linkVirtualIsland: true });
		expect(r!.code).toContain('ogygia:region/wrapper/');
		const isl = r!.islands![0]!;
		expect(isl.server).toBe(true);
		expect((isl.wrapperSource ?? '').length).toBeGreaterThan(0);
	});

	it('csr=false CLIENT leg: stub import (never the wrapper), island still carries wrapper source', () => {
		const r = transformHost(ROUTE_HOST, id, { ...ctx, ssr: false, linkVirtualIsland: false });
		expect(r!.code).not.toContain('ogygia:region/wrapper/');
		expect(r!.code).toContain('ogygia:region/client-binding-stub');
		const isl = r!.islands![0]!;
		expect(isl.server).toBe(true);
		// the registration payload must never be a downgrade — the registry gate needs the source
		expect((isl.wrapperSource ?? '').length).toBeGreaterThan(0);
	});

	it('already-transformed output does not conjure a phantom island from the fallback snippet', () => {
		// The exact input that produced the phantom: mark consumed, stub import, snippet child.
		const r = transformHost(PLUGIN_OUTPUT, id, { ...ctx, ssr: false, linkVirtualIsland: true });
		const portable = (r?.islands ?? []).filter((i) => (i as { portable?: boolean }).portable);
		expect(portable).toEqual([]);
	});
});
