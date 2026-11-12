<!--
@component
Tabbed content: `<TabGroup group="pm"><Tab label="npm">…</Tab></TabGroup>`. Markdown's
`::: code-group` and `::: tabs` blocks emit the same. One choice per `group` (default `tabs`),
shared by every block of that group and remembered across pages.
-->
<script lang="ts">
	import TabGroupIsland from './TabGroupIsland.svelte' with { wake: 'load' };
	import type { Snippet } from 'svelte';

	let { group = 'tabs', children }: { group?: string; children: Snippet } = $props();
</script>

<TabGroupIsland {group}>{@render children()}</TabGroupIsland>
