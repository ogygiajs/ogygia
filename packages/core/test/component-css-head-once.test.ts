// componentCssHead (src/plugin/css.ts): a router page's sheets are linked once per request, however
// many renders ask for them; off a request (a bare `router.fetch`) each call links its own.
import { afterEach, expect, test } from 'vitest';
import { componentCssHead } from '../src/plugin/css.ts';
import { register_router_css } from '../src/router-css.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

afterEach(() => set_request_event_stub(null));

const Layout = {};
register_router_css(Layout, () => [{ key: '/app/layout.css', href: '/app/layout.css' }]);
const links = (head: string) => head.match(/<link /g)?.length ?? 0;

test('a second call in one request links nothing its first call linked', async () => {
	const event = { route: { id: '/css-once' } };
	set_request_event_stub(() => event);
	expect(links(await componentCssHead([Layout]))).toBe(1);
	expect(await componentCssHead([Layout])).toBe('');
	expect(await componentCssHead([Layout])).toBe('');
});

test('off a request, every call links its sheets', async () => {
	expect(links(await componentCssHead([Layout]))).toBe(1);
	expect(links(await componentCssHead([Layout]))).toBe(1);
});
