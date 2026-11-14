<!--
@component
Cross-island context provider for plain `getContext(key)`: no `createContext` handle needed, and no
change to the consumer islands. It writes `values` into the page once, so islands below (which
hydrate as separate roots on a csr=false page) get them in their own context at hydrate, and it sets
Svelte's own context, so the server-rendered tree reads the same values. Values must be
serializable: plain data, `[ogygia.wire]` live values, region snippets; never a function or a live
store. A provider's values are read once, when it renders.
-->
<script lang="ts">
	import { setContext, untrack } from 'svelte';
	import { serialize_context } from './context-bridge.ts';
	import type { Snippet } from 'svelte';

	let {
		values,
		children
	}: {
		values: Record<string, unknown> | Array<Record<string, unknown> | false | null | undefined>;
		children?: Snippet;
	} = $props();

	const resolved = untrack(() =>
		Array.isArray(values)
			? (Object.assign({}, ...values.filter(Boolean)) as Record<string, unknown>)
			: values
	);

	for (const k of Reflect.ownKeys(resolved))
		setContext(k, (resolved as Record<PropertyKey, unknown>)[k]);

	// @why a closing script tag written out inside a script ends it, even in a comment (test: internal/checks/shipped-svelte.test.ts › every shipped component passes)
	const LT = String.fromCharCode(60);
	const GT = String.fromCharCode(62);
	const script =
		typeof window === 'undefined'
			? `${LT}script data-ogygia-provide${GT}${serialize_context(resolved)}${LT}/script${GT}`
			: '';
</script>

<ogygia-provide style="display:contents">{@html script}{@render children?.()}</ogygia-provide>
