<!--
@component
On-this-page headings with a scrollspy. Mount it as an island (`with { wake: 'load' }`): it wakes on
every page, after every navigation too. The spy marks the section being read and slides the rail
thumb to it, in this list and in the page's static mobile outline (`.og-mtoc`). The title entry
links to the page itself and scrolls to the top. Customize each row with the `item` snippet (then
apply your own active state); `.og-toc*` hooks for CSS.
-->
<script lang="ts">
	import { scope } from '@ogygia/machine';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { roving } from './roving.ts';
	import type { Heading } from '../types.ts';

	let {
		headings,
		title,
		label = 'On this page',
		scrollspy = true,
		item
	}: {
		headings: Heading[];
		/** The page title, shown as the FIRST entry (linking back to the top) — so the outline exists
		 *  even on a page with no headings, and reads like svelte.dev's. Active when nothing below
		 *  the fold is. */
		title?: string;
		label?: string;
		/** Highlight the section currently in view (default `true`). */
		scrollspy?: boolean;
		item?: Snippet<[Heading]>;
	} = $props();

	let active = $state('');

	// @why the page's path, not `location`: the same on the server, so the top link does not change as the page wakes (test: test/browser/on-this-page.test.ts › links the title to the page's own path, the same as on the server)
	const top_href = $derived(page.url.pathname);
	function to_top(e: MouseEvent) {
		e.preventDefault();
		window.scrollTo({ top: 0, behavior: 'smooth' });
		history.replaceState(history.state, '', top_href);
	}

	function spy(list: HTMLElement) {
		if (!scrollspy || !headings.length) return;
		const ids = headings.map((h) => h.id);
		// @why one scope: the window listeners and the frame go with the list (test: test/browser/on-this-page.test.ts › lets go of the window when it unmounts: a scroll after moves nothing)
		const s = scope();
		let queued = false;
		const pick = () => {
			queued = false;
			const seen: Array<{ id: string; top: number }> = [];
			for (const id of ids) {
				const el = document.getElementById(id);
				if (el) seen.push({ id, top: el.getBoundingClientRect().top });
			}
			if (!seen.length) return;
			let best = '';
			for (const s of seen) {
				if (s.top <= 120) best = s.id;
				else break;
			}
			// @why a short page: no heading crossed the fold line, but the first is in view (test: test/browser/on-this-page.test.ts › marks the first heading on a short page where none crossed the fold line)
			if (!best && seen[0].top <= innerHeight * 0.4) best = seen[0].id;
			// @why at the very bottom the last section is the one being read, though it never reaches the fold line (test: test/browser/on-this-page.test.ts › marks the last heading at the very bottom of the page)
			if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4)
				best = seen[seen.length - 1].id;
			active = best;
			const move_thumb = (ul: HTMLElement | null, set_active: boolean) => {
				if (!ul) return;
				if (set_active)
					ul.querySelectorAll('.og-active').forEach((a) => a.classList.remove('og-active'));
				const lnk = best ? ul.querySelector<HTMLElement>(`a[href="#${CSS.escape(best)}"]`) : null;
				if (lnk) {
					if (set_active) lnk.classList.add('og-active');
					ul.style.setProperty('--og-thumb-y', `${lnk.offsetTop}px`);
					ul.style.setProperty('--og-thumb-h', `${lnk.offsetHeight}px`);
					ul.classList.add('og-has-active');
				} else {
					ul.classList.remove('og-has-active');
				}
			};
			move_thumb(list, false);
			// @why Doc's mobile outline is static HTML with no spy of its own: this one marks it too (test: test/browser/on-this-page.test.ts › marks the last heading above the fold line, in its list and in the static outline)
			move_thumb(document.querySelector('.og-mtoc .og-toc-list'), true);
		};
		const onScroll = () => {
			if (queued) return;
			queued = true;
			s.timeout(pick, 'frame');
		};
		s.on(window, 'scroll', onScroll, { passive: true });
		s.on(window, 'resize', onScroll, { passive: true });
		pick();
		return () => s.close();
	}
</script>

{#if headings.length || title}
	<nav class="og-toc" aria-label={label}>
		<p class="og-toc-label">{label}</p>
		<ul
			class="og-toc-list"
			{@attach spy}
			{@attach roving({ selector: '.og-toc-link', orientation: 'vertical' })}
		>
			{#if title}
				<!-- The document top: a valid same-page link, but click just scrolls up (no nav). Active
				     whenever no heading is. -->
				<li class="og-toc-item og-toc-d2 og-toc-title">
					<a
						class="og-toc-link"
						class:og-active={active === ''}
						href={top_href}
						onclick={to_top}
						aria-current={active === '' ? 'true' : undefined}>{title}</a
					>
				</li>
			{/if}
			{#each headings as h (h.id)}
				<li class={`og-toc-item og-toc-d${h.depth}`}>
					{#if item}{@render item(h)}{:else}
						<a
							class="og-toc-link"
							class:og-active={h.id === active}
							href={`#${h.id}`}
							aria-current={h.id === active ? 'true' : undefined}>{h.text}</a
						>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>
{/if}
