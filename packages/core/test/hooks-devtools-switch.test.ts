import { afterAll, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ building: false }));
vi.mock('$app/env', () => ({
	get building() {
		return env.building;
	},
	browser: false,
	dev: false,
	version: 'test'
}));

const g = globalThis as Record<string, unknown>;
g.__OGYGIA_DEVTOOLS__ = true;
g.__OGYGIA_DEVTOOLS_LAZY__ = true;
const { handle } = await import('../src/hooks.ts');
afterAll(() => {
	delete g.__OGYGIA_DEVTOOLS__;
	delete g.__OGYGIA_DEVTOOLS_LAZY__;
});

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

/** A page request to a devtools build; what the browser's devtools switch came out as. */
async function visit(path: string, cookie?: string) {
	const u = new URL(path, 'https://app.test');
	const set: string[] = [];
	const deleted: string[] = [];
	const response = await handle()({
		event: {
			url: u,
			request: new Request(u),
			getClientAddress: () => '203.0.113.7',
			cookies: {
				get: () => cookie,
				set: (name: string, value: string) => set.push(`${name}=${value}`),
				delete: (name: string) => deleted.push(name)
			},
			route: { id: '/p' },
			params: {},
			isDataRequest: false,
			setHeaders() {},
			platform: undefined,
			locals: {}
		} as never,
		resolve: async (_event, opts) =>
			new Response((await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '', {
				headers: { 'content-type': 'text/html' }
			})
	});
	return { on: response.headers.get('document-policy') === 'js-profiling', set, deleted };
}

describe("a devtools build's switch, per browser", () => {
	it('is off for a browser that never turned it on', async () => {
		expect((await visit('/p')).on).toBe(false);
	});

	it("`?og-devtools=on` turns it on for this very response, and keeps it on in the browser's cookie", async () => {
		const r = await visit('/p?og-devtools=on');
		expect(r.on).toBe(true);
		expect(r.set.length).toBe(1);
	});

	it('the cookie keeps it on for the next page', async () => {
		const first = await visit('/p?og-devtools=on');
		const value = first.set[0].split('=').slice(1).join('=');
		expect((await visit('/p', value)).on).toBe(true);
	});

	it('`?og-devtools=off` turns it off and clears the cookie', async () => {
		const first = await visit('/p?og-devtools=on');
		const value = first.set[0].split('=').slice(1).join('=');
		const r = await visit('/p?og-devtools=off', value);
		expect(r.on).toBe(false);
		expect(r.deleted.length).toBe(1);
	});

	it('a prerendered page is off, whatever its URL says: it has no visitor to switch for', async () => {
		env.building = true;
		try {
			const r = await visit('/p?og-devtools=on');
			expect(r.on).toBe(false);
			expect(r.set).toEqual([]);
		} finally {
			env.building = false;
		}
	});
});
