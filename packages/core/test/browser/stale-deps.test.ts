// The dev stale-dep watchdog (runtime/stale-deps.ts) reloads a stranded tab once, whatever number of
// its islands fail to import together.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { recover_from_stale_deps } from '../../src/runtime/stale-deps.ts';

const real_fetch = window.fetch;
beforeEach(() => {
	sessionStorage.clear();
	// the entry still serves: a stale graph, not a missing module
	window.fetch = async () => new Response('export {}', { status: 200 });
});
afterEach(() => {
	window.fetch = real_fetch;
	sessionStorage.clear();
});

test('two islands that fail to import together reload the tab once', async () => {
	let reloads = 0;
	const reload = () => void reloads++;
	await Promise.all([
		recover_from_stale_deps('/a.js', reload),
		recover_from_stale_deps('/b.js', reload)
	]);
	expect(reloads).toBe(1);
});

test('a failure after the reload was asked for, in the same page, asks for none', async () => {
	let reloads = 0;
	const reload = () => void reloads++;
	await recover_from_stale_deps('/a.js', reload);
	await recover_from_stale_deps('/b.js', reload);
	expect(reloads).toBe(1);
});
