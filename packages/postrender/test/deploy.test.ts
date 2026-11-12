/**
 * A deploy is a write: a page stored by one build is never served by the next (#947). Prerender is
 * the special case where the only write is a deploy (internal/notes/freeze.md). The new build is
 * found the way federation finds it for its peers (the `lastBuild` marker), once per boot, and one
 * answer serves both: whichever asks first, the page path or federation's deploy thaw.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { ask } from '../../core/src/plugin/hooks.ts';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { install, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';

/** The build this "process" runs: a test boots another by changing it. */
const env = vi.hoisted(() => ({ version: 'v1' }));
vi.mock('$app/env', () => ({
	building: false,
	dev: false,
	get version() {
		return env.version;
	}
}));

const options: PostrenderServerOptions = { ttl: 60, default: true };
const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };

afterEach(() => {
	reset_for_tests();
	env.version = 'v1';
});

/** Boot `version` on the shared `store`: a new process, the same store. */
function boot(version: string, store: MemoryStore) {
	reset_for_tests();
	env.version = version;
	const runtime = install({ store });
	/** A visitor's GET of `path`: the stored copy's HTML, or null when the page renders (and is then
	 *  stored with `rendered`). */
	return async (path: string, rendered = `<p>${version}</p>`): Promise<string | null> => {
		const c = ctx(new Request('http://x.test' + path), { cookies: jar as never });
		mark_handled(c.event, runtime);
		try {
			const hit = await server.page?.(c);
			if (hit) return hit.text();
			await server.response?.(
				c,
				new Response(`<html><head></head><body>${rendered}</body></html>`, {
					headers: { 'content-type': 'text/html' }
				})
			);
			return null;
		} finally {
			server.done?.(c);
		}
	};
}

describe('a deploy is a write for the app’s own stored pages', () => {
	it('a page stored by the old build is not served by the new one: it renders, and is stored again', async () => {
		const store = new MemoryStore();
		const v1 = boot('v1', store);
		expect(await v1('/a/')).toBeNull();
		expect(await v1('/a/')).toContain('<p>v1</p>');

		const v2 = boot('v2', store);
		expect(await v2('/a/')).toBeNull(); // the old build's page is gone: it renders
		expect(await v2('/a/')).toContain('<p>v2</p>');
	});

	it('the same build booting again keeps its pages', async () => {
		const store = new MemoryStore();
		const v1 = boot('v1', store);
		expect(await v1('/a/')).toBeNull();
		const again = boot('v1', store);
		expect(await again('/a/')).toContain('<p>v1</p>');
	});

	it('federation asked first: the page path still finds the new build (one answer for both)', async () => {
		const store = new MemoryStore();
		const v1 = boot('v1', store);
		expect(await v1('/a/')).toBeNull();

		const v2 = boot('v2', store);
		// a producer's first federation request asks before any page is read
		expect(await ask.lastBuild('v2')).toBe('v1');
		expect(await v2('/a/')).toBeNull();
	});

	it('the page path asked first: federation still hears the previous build', async () => {
		const store = new MemoryStore();
		const v1 = boot('v1', store);
		expect(await v1('/a/')).toBeNull();

		const v2 = boot('v2', store);
		expect(await v2('/a/')).toBeNull();
		expect(await ask.lastBuild('v2')).toBe('v1');
	});
});
