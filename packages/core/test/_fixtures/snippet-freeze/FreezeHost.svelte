<script module lang="ts">
	import Child from './Child.svelte';

	export { text, elements, blocks, nested, component, odd, one_param, two_params, null_default };
</script>

{#snippet text()}plain text{/snippet}
{#snippet elements()}<p class="scoped" title="t">a<b>b</b><br /><img alt="i" /></p>{/snippet}
{#snippet blocks()}{#if true}yes{:else}no{/if}{#each [1, 2] as n, i}<i>{n}{i}</i
		>{/each}{#await Promise.resolve(1)}wait{:then v}{v}{/await}{/snippet}
{#snippet inner(x: string)}<em>{x}</em>{/snippet}
{#snippet nested()}<div>{@render inner('k')}{@render inner('j')}</div>{/snippet}
{#snippet component()}<Child title="c"><u>kid</u></Child><Child />{/snippet}
{#snippet odd()}{'</script><!-- "q" \'s\' é 😀   &amp;'}<span title={'</script>"<'}>{'<b>'}</span
	>{/snippet}
{#snippet one_param(a?: string)}{a ?? 'none'}{/snippet}
{#snippet two_params(a?: string, b?: number)}{String(a)}/{String(b)}{/snippet}
{#snippet null_default(a: string | null = null)}{a === null ? 'null' : a}{/snippet}

<style>
	.scoped {
		color: red;
	}
</style>
