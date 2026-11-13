// The router's request path ("answer"): a request through `routes(table).fetch`, from the base and
// slash handling and the match to the verb pick, the context, a shared memoized load and the
// endpoint's JSON response. Endpoints only: a page render needs the Kit app around it.
import { bench } from '@bench/heisenbench/bench';
import { clearRouteConfig } from '@ogygia/core/plugin/testing';
import type { Ctx } from '../src/ctx.ts';
import { load, routes } from '../src/index.ts';

type Table = Parameters<typeof routes>[0];
type Handler = (c: Ctx) => Response | Promise<Response>;

const RESOURCES = ['posts', 'users', 'orders', 'products', 'invoices', 'teams', 'files', 'tags'];

/** An API of `resources` resources: list, item (with a memoized load), history, three verbs. */
function table(resources: number): Table {
	const t: Record<string, Record<string, Handler>> = {
		'/': { GET: (c) => c.json({ home: true }) }
	};
	for (let r = 0; r < resources; r++) {
		const name = `${RESOURCES[r % RESOURCES.length]}${r < RESOURCES.length ? '' : r}`;
		const item = load((c) => ({ id: c.params.id, name, tags: ['a', 'b'] }));
		t[`/api/${name}`] = {
			GET: (c) => c.json({ list: name, page: c.search.page ?? '1' }),
			POST: (c) => c.json({ created: name })
		};
		t[`/api/${name}/[id]`] = {
			GET: async (c) => c.json({ item: await item(c), again: await item(c) }),
			PUT: (c) => c.json({ updated: c.params.id })
		};
		t[`/api/${name}/[id]/history/[...rest]`] = {
			GET: (c) => c.json({ rest: c.params.rest })
		};
	}
	return t as unknown as Table;
}

bench(
	'routes().fetch: forty requests across a 100-route API',
	async ({ app, reqs }) => {
		let ok = 0;
		for (const r of reqs) {
			const res = await app.fetch(r());
			if (res && res.status < 400) ok++;
		}
		return ok;
	},
	{
		setup: () => {
			clearRouteConfig();
			const app = routes(table(33));
			const reqs: Array<() => Request> = [];
			for (let i = 0; i < 40; i++) {
				const name = RESOURCES[i % RESOURCES.length];
				const path =
					i % 4 === 0
						? `/api/${name}?page=${i}`
						: i % 4 === 1
							? `/api/${name}/${i}`
							: i % 4 === 2
								? `/api/${name}/${i}/history/2026/09/${i}`
								: `/api/${name}/${i}/`;
				const method = i % 5 === 0 ? 'PUT' : 'GET';
				reqs.push(() => new Request(`http://example.test${path}`, { method }));
			}
			return { app, reqs };
		},
		teardown: () => clearRouteConfig()
	}
);

bench(
	'routes().fetch: text and json answers with given headers, twenty requests',
	async ({ app, reqs }) => {
		let bytes = 0;
		for (const r of reqs) {
			const res = await app.fetch(r());
			if (res) bytes += (await res.text()).length;
		}
		return bytes;
	},
	{
		setup: () => {
			clearRouteConfig();
			const app = routes({
				'/text': { GET: (c) => c.text('plain', { headers: { 'x-a': '1' } }) },
				'/html': {
					GET: (c) => c.text('<p>', { headers: new Headers({ 'Content-Type': 'text/html' }) })
				},
				'/json': { GET: (c) => c.json({ ok: true }, { headers: [['x-a', '1']] }) }
			});
			const paths = ['/text', '/html', '/json'];
			const reqs: Array<() => Request> = [];
			for (let i = 0; i < 20; i++)
				reqs.push(() => new Request(`http://example.test${paths[i % paths.length]}`));
			return { app, reqs };
		},
		teardown: () => clearRouteConfig()
	}
);
