// A HYDRATION RUN IS ITS VISIT'S (runtime/core.ts `#hydrate`). A region taken out of the page while
// its island's module loads, and put back, starts a new visit of its wake: a web component that
// re-slots its children, a header that re-renders, a layout that moves a node. The old run is out
// of its visit and must touch nothing of the new one: the island mounts ONCE, and the old run's
// failure is not the new visit's (no failed state, no error said for it, no report).
import { afterEach, expect, inject, test, vi } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';

const SLOW = '/test/browser/fixtures/slow-entry.ts';
const SLOW_FAIL = '/test/browser/fixtures/slow-fail-entry.ts';
const island = (entry: string) =>
	from_b64(inject('counter_ssr_b64')).replace(/entry="[^"]*"/, `entry="${entry}"`);

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

/** Out of the page past its task, then back where it was (in front of its props sidecar). */
async function out_and_back(el: Element, while_out?: () => void): Promise<void> {
	const spot = el.nextSibling;
	const parent = el.parentNode!;
	el.remove();
	await tick(10); // past its task: its visit is over
	while_out?.();
	parent.insertBefore(el, spot);
}

/** Its module is on its way: the resource is in the timeline. */
async function loading(name: string): Promise<void> {
	await expect
		.poll(() => performance.getEntriesByType('resource').some((r) => r.name.includes(name)), {
			timeout: 5_000
		})
		.toBe(true);
}

test('a region put back while its island loads mounts it once', async () => {
	document.body.innerHTML = island(`${SLOW}?once`);
	const el = document.querySelector<HTMLElement>('ogygia-region')!;
	const ssr_button = el.querySelector('button')!;
	let hydrated = 0;
	el.addEventListener('ogygia:hydrated', () => hydrated++);
	bootDev();
	await loading('slow-entry.ts?import&once');
	await out_and_back(el);
	await expect.poll(() => el.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	await tick(300);
	expect(hydrated, 'one mount').toBe(1);
	expect(el.querySelector('button'), 'the server button, adopted once').toBe(ssr_button);
	el.querySelector('button')!.click();
	await tick(0);
	expect(el.querySelector('[data-testid="count"]')!.textContent, 'one handler').toBe('4');
});

test('an old run’s failure leaves the new visit alone', async () => {
	// The old visit loads a module that fails as it loads (400 ms); the element comes back carrying
	// a module that loads (400 ms too), so the old failure lands while the new visit is waking.
	document.body.innerHTML = island(SLOW_FAIL);
	const el = document.querySelector<HTMLElement>('ogygia-region')!;
	const errors: string[] = [];
	vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
		errors.push(a.map((x) => String((x as Error)?.message ?? x)).join(' '));
	});
	let hydrated = 0;
	el.addEventListener('ogygia:hydrated', () => hydrated++);
	bootDev();
	await loading('slow-fail-entry.ts');
	await out_and_back(el, () => el.setAttribute('entry', `${SLOW}?fresh`));
	await expect
		.poll(() => el.hasAttribute('data-hydrated'), {
			timeout: 5_000,
			message: 'the new visit hydrated'
		})
		.toBe(true);
	await tick(300);
	expect(hydrated, 'one mount').toBe(1);
	el.querySelector('button')!.click();
	await tick(0);
	expect(el.querySelector('[data-testid="count"]')!.textContent, 'the island is live').toBe('4');
	expect(errors, 'nothing said for a run whose visit was over').toEqual([]);
});
