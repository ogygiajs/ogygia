<!--
@component
One overridable markdown element, `tag`, with its attributes and children. It renders the component
the shell context's `components` map gives for the tag; else `Link` for `a`, so a slug-form href
resolves under the base; else the plain element.
-->
<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { get_shell_context } from '../context.ts';
	import Link from './Link.svelte';

	let { tag, children, ...rest }: { tag: string; children?: Snippet } & Record<string, unknown> =
		$props();

	const DEFAULTS: Record<string, Component<Record<string, unknown>>> = {
		a: Link as Component<Record<string, unknown>>
	};
	const map = get_shell_context()?.components ?? {};
	const Comp = $derived(map[tag] ?? DEFAULTS[tag]);
</script>

{#if Comp}
	<Comp {...rest}>{@render children?.()}</Comp>
{:else}
	<svelte:element this={tag} {...rest}>{@render children?.()}</svelte:element>
{/if}
