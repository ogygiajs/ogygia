// goto() is a promise for every outcome: a URL it refuses (not http, another origin, unparsable)
// is the promise's rejection, never a throw out of the call, the same as Kit's goto (#1350).
import { expect, test } from 'vitest';
import { mpa_nav } from '../../src/runtime/nav-handle.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import * as shim from '../../src/shims/app-navigation.ts';

const NAV = Symbol.for('ogygia.nav');
const KIT = Symbol.for('ogygia.kit-page');
const scope = globalThis as unknown as Record<symbol, unknown>;

type Goto = (url: string) => Promise<void>;

/** What `goto(url)` gave: the rejection's message, or that it threw out of the call. */
async function outcome(goto: Goto, url: string): Promise<string> {
	let returned: Promise<void>;
	try {
		returned = goto(url);
	} catch {
		return 'threw';
	}
	return returned.then(
		() => 'resolved',
		(e: unknown) => String((e as Error).message)
	);
}

const cases: Array<[string, RegExp]> = [
	['https://elsewhere.example/x', /goto_cross_origin/],
	['javascript:alert(1)', /goto_not_http/]
];

test('the router: a refused URL rejects the promise', async () => {
	const router = new SpaRouter();
	for (const [url, code] of cases) expect(await outcome((u) => router.goto(u), url)).toMatch(code);
});

test('the handle without the router: a refused URL rejects the promise', async () => {
	const nav = mpa_nav();
	for (const [url, code] of cases) expect(await outcome((u) => nav.goto(u), url)).toMatch(code);
});

test('the $app/navigation shim with no runtime: a refused URL rejects the promise', async () => {
	delete scope[NAV];
	delete scope[KIT];
	for (const [url, code] of cases) expect(await outcome((u) => shim.goto(u), url)).toMatch(code);
});
