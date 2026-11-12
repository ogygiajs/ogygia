// The remote-seeds feature (src/runtime/remote-seeds.ts): the page's `application/ogygia-remote`
// script seeds the Kit client query cache once per document, and again only after a navigation
// replaced the page.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const seeded = vi.hoisted(() => [] as string[]);
vi.mock('../src/shims/kit-remote/client-stub.ts', () => ({
	seed_query_responses: (text: string) => seeded.push(text)
}));

const { install } = await import('../src/runtime/remote-seeds.ts');
const { slots } = await import('../src/runtime/slots.ts');
const { RuntimeSession } = await import('../src/runtime/session.ts');
const { server_channel } = await import('../src/runtime/response-mark.ts');

/** A script the server wrote: it bears the document's response mark. */
const server_script = (text: string) => ({ textContent: text, getAttribute: () => 'mark' });

let script: ReturnType<typeof server_script> | null = null;
const was_boot = slots.boot;
const session = new RuntimeSession();

beforeEach(() => {
	seeded.length = 0;
	script = server_script('{"q":1}');
	vi.stubGlobal('document', {
		head: { querySelector: () => ({ getAttribute: () => 'mark' }) },
		querySelectorAll: (sel: string) =>
			sel === 'script[type="application/ogygia-remote"]' && script ? [script] : []
	});
	slots.boot = { runtime_session: session, server_channel } as unknown as typeof slots.boot;
	session.reset();
	install();
});
afterEach(() => {
	vi.unstubAllGlobals();
	slots.boot = was_boot;
});

test('the page’s remote script seeds the query cache once per document', () => {
	slots.remoteSeeds!.seed_once();
	slots.remoteSeeds!.seed_once();
	expect(seeded).toEqual(['{"q":1}']);
});

test('after a navigation replaced the page, the new page’s script seeds again', () => {
	slots.remoteSeeds!.seed_once();
	session.reset();
	script = server_script('{"q":2}');
	slots.remoteSeeds!.seed_once();
	expect(seeded).toEqual(['{"q":1}', '{"q":2}']);
});

test('a page without the script seeds nothing, and is done', () => {
	script = null;
	slots.remoteSeeds!.seed_once();
	script = server_script('{"late":1}');
	slots.remoteSeeds!.seed_once();
	expect(seeded).toEqual([]);
});
