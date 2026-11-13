// A server whose `federate()` has not run yet (#1501: the module that calls it is imported by one
// route's `+page.server.ts`, not by hooks.server.ts) still falls through on a federation path, but
// it says why, once, with a code: a deferred hole or a peer endpoint asked of it was a bare 404.
import { afterEach, expect, it, vi } from 'vitest';
import { set_federation } from '../src/registry.ts';
import { serve_federation } from '../src/serve.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import fed_server from '../src/server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.restoreAllMocks();
	set_federation(null);
});

const ask = (path: string) => {
	const url = new URL(`https://shell.internal${path}`);
	return serve_federation({ url, request: new Request(url) } as never);
};

it('a federation request with no federate() run says federation_unregistered, once', async () => {
	const warned: string[] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(a.join(' ')));
	set_federation(null);
	for (const path of ['/og/frag?h=x', '/og/thaw', '/og/fragment/page?path=/', '/og/fragment/card'])
		expect(await ask(path)).toBeNull();
	expect(warned.filter((w) => w.includes('federation_unregistered'))).toHaveLength(1);
});

it('a path that is not a federation one says nothing', async () => {
	const warned: string[] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(a.join(' ')));
	expect(await ask('/about')).toBeNull();
	expect(warned).toEqual([]);
});
