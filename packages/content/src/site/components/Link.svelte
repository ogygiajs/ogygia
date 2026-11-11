<!--
@component
The dialect's `a`: prose links are page addresses, not URLs. A bare href (`regions/held`: no
scheme, no leading `/`, `#` or `.`) resolves through the site under the shell's mount, so prose
never hardcodes the mount; an old address in the site's redirect history resolves to its page. Any
other href, an unknown address, or any href outside a `<Shell>` is left as written.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { get_shell_context } from '../context.ts';
	import { href_of } from '../outline.ts';

	const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

	let {
		href = '',
		children,
		...rest
	}: { href?: string; children?: Snippet } & Record<string, unknown> = $props();

	const ctx = get_shell_context();

	function is_bare(h: string): boolean {
		return (
			!!h &&
			!URL_SCHEME_RE.test(h) &&
			!h.startsWith('/') &&
			!h.startsWith('#') &&
			!h.startsWith('.') &&
			!h.startsWith('//')
		);
	}

	async function resolve(h: string): Promise<string> {
		const [slug, frag] = h.split('#');
		const tail = frag ? `#${frag}` : '';
		const hit = await ctx!.site!.outline.resolve(slug);
		if (hit) return href_of(ctx!.base, hit.record.slug) + tail;
		const canonical = await ctx!.site!.outline.alias(slug);
		if (canonical) return href_of(ctx!.base, canonical) + tail;
		return h;
	}

	// svelte-ignore state_referenced_locally
	const resolved = ctx?.site && is_bare(href) ? await resolve(href) : href;
</script>

<a {...rest} href={resolved}>{@render children?.()}</a>
