// THE REMOTE MUTATION CACHE BUST NEVER BREAKS THE APP'S FETCH (runtime/router-nav.ts
// `install_remote_mutation_cache_bust`). The router wraps `window.fetch` when its chunk loads, so a
// Kit remote command or form that lands empties the page cache. The wrap only reads the request it
// passes on: whatever it cannot read, the app still gets its answer.
import { expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';

const asked: string[] = [];
window.fetch = async (input) => {
	asked.push(String(input));
	return new Response('ok', { status: 200 });
};
link_boot();
await import('../../src/runtime/router-nav.ts');

test('a request whose method cannot be read still gets its answer', async () => {
	const init = {
		get method(): string {
			throw new Error('a method the app reads lazily');
		}
	} as RequestInit;
	const res = await window.fetch('/_app/remote/x', init).catch((e: unknown) => e);
	expect(res).toBeInstanceOf(Response);
	expect(asked).toContain('/_app/remote/x');
});
