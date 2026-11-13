// THE PAGE ON SCREEN IS AT THE ADDRESS BAR'S ADDRESS (#1526). An app's own in-place
// `history.replaceState` (a tracking param stripped) moves the address of the entry the router has
// on screen: the router reads it, with no call into ogygia.
import { afterEach, expect, test } from 'vitest';
import { RouterHistory } from '../../src/runtime/router.ts';

const home = location.href;
afterEach(() => history.replaceState(null, '', home));

const tracked = new URL('?utm_source=mail&tab=2', home);
const stripped = new URL('?tab=2', home);

type State = { ogygia?: unknown; app?: string };
const state = () => history.state as State;

test('a page script strips a tracking param, keeping the state: the page on screen is at the stripped address', () => {
	history.replaceState(null, '', tracked.href);
	const h = new RouterHistory();
	h.start();
	history.replaceState(history.state, '', stripped.href);
	expect(h.current.url.href).toBe(stripped.href);
});

test('a page script strips a tracking param with its own state: the page on screen is at the stripped address, and named again', () => {
	history.replaceState(null, '', tracked.href);
	const h = new RouterHistory();
	h.start();
	history.replaceState({ app: 'own' }, '', stripped.href);
	const entry = h.current;
	expect(entry.url.href).toBe(stripped.href);
	expect(state()).toEqual({ app: 'own', ogygia: entry.id });
});

test('a back step: the page being left keeps its own address while the bar is already on the next', () => {
	const h = new RouterHistory();
	h.start();
	const first = h.current;
	const second = h.commit(new URL('?elsewhere=1', home), 'push');
	history.replaceState({ ogygia: first.id }, '', home);
	expect(h.current).toBe(second);
	expect(h.current.url.href).toBe(new URL('?elsewhere=1', home).href);
});

test('a page script strips a tracking param, then the router moves on and back: the entry left keeps the stripped address', () => {
	history.replaceState(null, '', tracked.href);
	const h = new RouterHistory();
	h.start();
	history.replaceState(history.state, '', stripped.href);
	const first = h.current;
	h.commit(new URL('?elsewhere=1', home), 'push');
	expect(first.url.href).toBe(stripped.href);
});
