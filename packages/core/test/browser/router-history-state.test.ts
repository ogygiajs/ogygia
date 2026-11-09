// THE APP'S OWN HISTORY STATE SURVIVES THE ROUTER'S HISTORY MODEL (#310). The router names each
// entry it takes over with an id in `history.state` (`{ ogygia: id }`). An entry it meets that
// already carries the app's state (state the document was loaded with, an app's own `pushState`, Kit
// shallow-routing state) keeps that state: the id goes beside it, never over it.
import { afterEach, expect, test } from 'vitest';
import { RouterHistory } from '../../src/runtime/router.ts';

const home = location.href;
afterEach(() => history.replaceState(null, '', home));

type State = { ogygia?: unknown; app?: string };
const state = () => history.state as State;

test('start(): the entry the router starts on keeps the app’s state', () => {
	history.replaceState({ app: 'loaded with' }, '', home);
	const h = new RouterHistory();
	h.start();
	expect(state().app).toBe('loaded with');
	expect(state().ogygia).toBe(h.current.id);
});

test('adopt(): an app’s own pushState entry the router meets keeps the app’s state', () => {
	const h = new RouterHistory();
	h.start();
	const url = new URL('#modal', home);
	history.pushState({ app: 'modal open' }, '', url.href);
	const entry = h.adopt(url);
	expect(state().app).toBe('modal open');
	expect(state().ogygia).toBe(entry.id);
});

test('commit(replace): the entry replaced in place keeps the app’s state', () => {
	const h = new RouterHistory();
	h.start();
	history.replaceState({ ...(history.state as object), app: 'shallow' }, '', home);
	const entry = h.commit(new URL('?tab=2', home), 'replace');
	expect(state().app).toBe('shallow');
	expect(state().ogygia).toBe(entry.id);
});
