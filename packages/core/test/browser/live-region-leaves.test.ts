import { afterEach, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { observe } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

/** A module the dev server has. */
const LABEL = '/test/browser/fixtures/Label.svelte';
const label_html = () => from_b64(inject('label_render_b64'));

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		hydrate?: string;
	}): Promise<void>;
};

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

test('a live region taken off the page while its island loads goes back to rest, and nothing hydrates', async () => {
	const live = document.createElement('ogygia-region') as LiveRegion;
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();

	const steps: string[] = [];
	const off = observe((name, from, to) => {
		if (name !== 'live-region') return;
		steps.push(`${from?.kind} -> ${to?.kind}`);
		if (to?.kind === 'hydrating') queueMicrotask(() => live.remove());
	});
	try {
		await live.applyLive({
			id: 'live-leaves-loading',
			module: LABEL,
			props: { text: 'loading' },
			html: label_html().replace('one', 'loading'),
			hydrate: 'load'
		});
		await expect.poll(() => steps.at(-1)).toBe('hydrating -> idle');
		await new Promise((r) => setTimeout(r, 300));
	} finally {
		off();
	}
	expect(steps).not.toContain('hydrating -> live');
	expect(live.hasAttribute('data-hydrated')).toBe(false);
});
