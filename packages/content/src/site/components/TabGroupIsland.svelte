<!--
@component
The interactive half of TabGroup, an island. The panels arrive as frozen server HTML; on mount it
builds the tab bar from the panels' own `data-label`s and wires the tablist keyboard (arrows move
focus, a click or Space/Enter selects). One choice per group is shared by every block on the page and
saved for the next one (./tab-groups.svelte.ts).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { on } from 'svelte/events';
	import { roving } from './roving.ts';
	import { tab_group, hydrate_group } from './tab-groups.svelte.ts';
	import type { Snippet } from 'svelte';

	let { group = 'tabs', children }: { group?: string; children: Snippet } = $props();
	const g = $derived(tab_group(group));

	function control(root: HTMLElement) {
		const panels = [...root.querySelectorAll<HTMLElement>('.og-tabs-panel')];
		const labels = panels.map((p) => p.dataset.label ?? '');
		if (!labels.length) return;

		const bar = document.createElement('div');
		bar.className = 'og-tabs-bar';
		bar.setAttribute('role', 'tablist');
		const marker = document.createElement('span');
		marker.className = 'og-tabs-marker';
		marker.setAttribute('aria-hidden', 'true');
		bar.appendChild(marker);
		const btns = labels.map((label) => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'og-tabs-tab';
			btn.setAttribute('role', 'tab');
			btn.dataset.label = label;
			btn.textContent = label;
			bar.appendChild(btn);
			return btn;
		});
		root.insertBefore(bar, root.firstChild);

		const place = (i: number) => {
			const b = btns[i];
			if (!b) return;
			if (!marker.dataset.init) marker.style.transition = 'none';
			marker.style.transform = `translateX(${b.offsetLeft - bar.clientLeft}px)`;
			marker.style.width = `${b.offsetWidth}px`;
			marker.style.opacity = '1';
			if (!marker.dataset.init) {
				marker.dataset.init = '1';
				void marker.offsetWidth;
				marker.style.transition = '';
			}
		};
		const apply = (i: number, focus = false) => {
			panels.forEach((p, j) => (p.hidden = j !== i));
			btns.forEach((b, j) => {
				b.setAttribute('aria-selected', String(j === i));
				b.tabIndex = j === i ? 0 : -1;
			});
			place(i);
			if (focus) btns[i].focus();
		};
		const activate = (i: number, focus = false) => {
			apply(i, focus);
			try {
				g.value = labels[i];
			} catch {
				// ok: the store's set only fails on storage, which it already handles; the tabs above are switched
			}
		};

		const off1 = on(bar, 'click', (e) => {
			const t = (e.target as Element).closest('.og-tabs-tab');
			if (t) activate(btns.indexOf(t as HTMLButtonElement), true);
		});
		// @why arrows only move focus: selecting on an arrow would swap the panel under someone just reading the tab names (test: test/browser/tab-group-island.test.ts › moves focus with the arrows without selecting; a click selects)
		const off2 = roving({ selector: '.og-tabs-tab', orientation: 'horizontal' })(bar) ?? (() => {});
		const off3 = on(window, 'resize', () =>
			place(btns.findIndex((b) => b.getAttribute('aria-selected') === 'true'))
		);

		// @why untracked: a tracked read of the choice would rebuild the bar on every selection and cut the marker's glide (test: test/browser/tab-group-island.test.ts › keeps the same bar and marker across a selection)
		untrack(() => {
			hydrate_group(group, labels[0]);
			const start = Math.max(0, labels.indexOf(g.value ?? labels[0]));
			activate(start);
			if (document.fonts?.ready) document.fonts.ready.then(() => place(start));
		});
		// @why a nested effect: other blocks of the group follow on the bar they have, so their marker glides too (test: test/browser/tab-group-island.test.ts › a choice in one block moves every block of the same group, and is saved)
		$effect(() => {
			const v = g.value;
			untrack(() => {
				const i = labels.indexOf(v ?? '');
				if (i >= 0 && btns[i]?.getAttribute('aria-selected') !== 'true') apply(i);
			});
		});

		return () => {
			off1();
			off2();
			off3();
			bar.remove();
		};
	}
</script>

<div class="og-tabs" data-group={group} {@attach control}>
	<div class="og-tabs-panels">{@render children()}</div>
</div>
