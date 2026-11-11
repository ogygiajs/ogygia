// Sheet: a dialog labelled `label` that holds `children` and a pinned `footer`. A press on a
// `data-ph-sheet-toggle` button outside it leaves it open (that button toggles it itself); a press
// anywhere else outside closes it.
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import Sheet from '../../src/site/components/Sheet.svelte';

const html = (s: string) => createRawSnippet(() => ({ render: () => s }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

async function until<T>(read: () => T | null | undefined): Promise<T> {
	for (let i = 0; i < 100; i++) {
		const value = read();
		if (value) return value;
		await frame();
	}
	throw new Error('never came');
}

afterEach(() => {
	document.body.replaceChildren();
});

async function open_sheet(props: Record<string, unknown> = {}) {
	const outside = document.createElement('div');
	// The open dialog turns pointer events off on the body; the shell's bar turns them back on
	// (shell.css), so both buttons here do too.
	outside.innerHTML =
		'<button data-ph-sheet-toggle style="pointer-events:auto">menu</button>' +
		'<button class="elsewhere" style="pointer-events:auto">elsewhere</button>';
	const target = document.createElement('div');
	document.body.append(outside, target);
	const state = { open: true }; // the parent's side of `bind:open`
	const app = mount(Sheet, {
		target,
		props: {
			get open() {
				return state.open;
			},
			set open(v: boolean) {
				state.open = v;
			},
			children: html('<p class="inside">links</p>'),
			...props
		}
	});
	flushSync();
	const sheet = await until(() => document.querySelector<HTMLElement>('.og-sheet'));
	return { sheet, outside, state, close: () => unmount(app) };
}

describe('Sheet', () => {
	it('opens as a dialog labelled Menu with the children and the footer', async () => {
		const s = await open_sheet({ footer: html('<a class="gh">source</a>') });
		try {
			expect(s.sheet.getAttribute('role')).toBe('dialog');
			expect(s.sheet.getAttribute('aria-label')).toBe('Menu');
			expect(s.sheet.querySelector('.og-sheet-body .inside')).not.toBeNull();
			expect(s.sheet.querySelector('.og-sheet-footer .gh')).not.toBeNull();
		} finally {
			await s.close();
		}
	});

	it('takes its label from label', async () => {
		const s = await open_sheet({ label: 'Search' });
		try {
			expect(s.sheet.getAttribute('aria-label')).toBe('Search');
		} finally {
			await s.close();
		}
	});

	it('stays open on a press of the sheet toggle outside it, and closes on any other', async () => {
		const s = await open_sheet();
		try {
			await sleep(200); // the dialog listens for outside presses once it has opened
			await userEvent.click(s.outside.querySelector('[data-ph-sheet-toggle]')!, { force: true });
			await sleep(200);
			expect(s.state.open).toBe(true);
			await userEvent.click(s.outside.querySelector('.elsewhere')!, { force: true });
			await until(() => !s.state.open);
			expect(s.state.open).toBe(false);
		} finally {
			await s.close();
		}
	});
});
