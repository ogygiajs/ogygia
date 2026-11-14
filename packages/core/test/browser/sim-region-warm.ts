// What a simulated run of a region element cannot own, done once before the runs: the island
// modules' first loads (real module loads, at the runtime's own module URLs), the document's
// once-only gates (painted, critical resources), the hydrate core and the interaction capture's
// replay half. A gate or a chunk first asked for inside a run would wait on that run's clock after
// the run ended.
import { inject } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { after_document_painted } from '../../src/runtime/schedule.ts';
import { critical_settled } from '../../src/runtime/load-scheduler.ts';

export const COUNTER = '/test/browser/fixtures/Counter.svelte';
export const LABEL = '/test/browser/fixtures/Label.svelte';
export const PROBE = '/test/browser/fixtures/LiveProbe.svelte';
export const counter_html = (): string => from_b64(inject('counter_render_b64'));
export const label_html = (): string => from_b64(inject('label_render_b64'));

export type LiveRegion = HTMLElement & { applyLive(desc: Record<string, unknown>): Promise<void> };

async function until(done: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 25));
	if (!done()) throw new Error(`the warm-up: ${what} never happened`);
}

export async function warm_up(): Promise<void> {
	bootDev();
	await after_document_painted();
	await critical_settled();
	const ssr = from_b64(inject('counter_ssr_b64'));
	// a scheduled wake (the hydrate core) and a visitor's (the replay half)
	document.body.innerHTML = ssr;
	const woke = document.querySelector('ogygia-region')!;
	await until(() => woke.hasAttribute('data-hydrated'), 'a scheduled wake');
	document.body.innerHTML = ssr.replace(/wake="[^"]*"/, 'wake="interaction"');
	const visited = document.querySelector('ogygia-region')!;
	visited
		.querySelector('button')!
		.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	visited.querySelector('button')!.click();
	await until(() => visited.hasAttribute('data-hydrated'), 'a visitor’s wake');
	document.body.innerHTML = '';
	// the live modules, loaded the way a live tick loads them
	for (const module of [LABEL, PROBE]) {
		const live = document.createElement('ogygia-region') as LiveRegion;
		live.setAttribute('live', '');
		document.body.append(live);
		await live.applyLive({
			id: 'sim-warm',
			module,
			props: { text: 'one' },
			html: label_html(),
			hydrate: 'load'
		});
		await until(() => live.hasAttribute('data-hydrated'), `a live tick of ${module}`);
		live.remove();
	}
	await new Promise((r) => setTimeout(r, 0));
}
