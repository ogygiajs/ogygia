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

test('an entry the server no longer serves is a real missing module: no reload, the error stays', async () => {
	window.fetch = async () => new Response('', { status: 404 });
	let reloads = 0;
	await recover_from_stale_deps('/gone.js', () => void reloads++);
	expect(reloads).toBe(0);
});

test('with no session storage nothing could stop the next page reloading too: no reload', async () => {
	const own = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
	Object.defineProperty(window, 'sessionStorage', {
		configurable: true,
		get() {
			throw new DOMException('blocked', 'SecurityError');
		}
	});
	try {
		let reloads = 0;
		await recover_from_stale_deps('/a.js', () => void reloads++);
		expect(reloads).toBe(0);
	} finally {
		if (own) Object.defineProperty(window, 'sessionStorage', own);
		else delete (window as { sessionStorage?: Storage }).sessionStorage;
	}
});

test('code from an origin the page loads no code from is never fetched to confirm', async () => {
	const asked: string[] = [];
	window.fetch = async (input) => {
		asked.push(String(input));
		return new Response('export {}', { status: 200 });
	};
	let reloads = 0;
	await recover_from_stale_deps('https://elsewhere.example.com/a.js', () => void reloads++);
	expect(asked).toEqual([]);
	expect(reloads).toBe(0);
});

test('a failure after the reload was asked for, in the same page, asks for none', async () => {
	let reloads = 0;
	const reload = () => void reloads++;
	await recover_from_stale_deps('/a.js', reload);
	await recover_from_stale_deps('/b.js', reload);
	expect(reloads).toBe(1);
});
