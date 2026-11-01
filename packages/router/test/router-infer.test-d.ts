/* Type-level guard for router v2 `$infer` — merged cascade data (Kit's rule), schema-coerced params,
 * typed search, action-return form, and layout keys `App['(name)']`. tsc-only (no runtime). */
import { routes, page, layout, type StandardSchemaV1 } from '../src/index.ts';
import type { Component } from 'svelte';

const C = (() => {}) as unknown as Component<Record<string, unknown>>;
const NumId: StandardSchemaV1<{ id: number }> = {
	'~standard': {
		version: 1,
		vendor: 't',
		validate: () => ({ value: { id: 1 } }),
		types: { output: { id: 0 } }
	}
};

const shell = layout('app', C, { load: async () => ({ user: 'ada' as string }) });
const section = layout('docs', C, { load: async () => ({ nav: ['a'] as string[] }) });

const app = routes(
	shell({
		'/': page(C, { load: async () => ({ featured: ['x'] as string[] }) }),
		'/post/[id]': page(C, { params: NumId, load: async (c) => ({ n: c.params.id }) }),
		'/login': page(C, { actions: { default: async () => ({ ok: true as boolean }) } }),
		'/search': page(C, {
			search: NumId as unknown as StandardSchemaV1<{ q: string }>,
			load: async (c) => ({ q: c.search.q })
		}),
		...section({
			'/docs/[slug]': page(C, { load: async (c) => ({ doc: c.params.slug }) })
		}),
		'/api/[id]': { GET: (c) => new Response(c.params.id) }
	}),
	{ error: C }
);
type App = typeof app.$infer;

// ── endpoint entries + the typed api() client ─────────────────────────────────────────────────
import { GET, POST, api, when, type Handler } from '../src/index.ts';

/** exact type equality: assignable both ways, and not `any` */
type Equal<A, B> =
	(<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
const expect_type = <T extends true>(_proof: T): void => {};

const Body: StandardSchemaV1<{ title: string }> = NumId as never;

// THE KEY TYPES EVERY HANDLER: strict params, the handler's own return kept — bare or wrapped,
// top-level, under a layout, under nested layouts, behind `when()`.
const admin = layout('admin', C);
const deep = layout('deep', C);
// a handler written OUTSIDE the table: `satisfies` checks it against its route, return type kept
const outside = ((c) => ({
	id: c.params.id,
	outside: true as const
})) satisfies Handler<'/out/[id]'>;
const typedApp = routes({
	'/posts/[id]': { GET: (c) => ({ id: c.params.id, title: 'x' as string }) },
	'/wrapped/[id]': { GET: GET((c) => ({ wrapped: c.params.id })) },
	'/posts': { POST: POST(Body, (c) => ({ created: c.input.title })) },
	'/posts/[id]/edit': { PUT: POST(Body, (c) => ({ id: c.params.id, title: c.input.title })) },
	...admin({
		'/admin/[user]': { GET: (c) => ({ user: c.params.user }) },
		...deep({
			'/admin/[user]/[tab]': { GET: GET((c) => ({ tab: c.params.tab, user: c.params.user })) }
		})
	}),
	'/gated/[id]': when(() => true, { GET: (c) => ({ gated: c.params.id }) }),
	'/out/[id]': { GET: outside },
	// a raw Response return erases to unknown (its payload is inside the Response)
	'/raw': { GET: (c) => c.json({ opaque: true }) }
});
type TApp = typeof typedApp.$infer;

expect_type<Equal<TApp['/posts/[id]']['get']['out'], { id: string; title: string }>>(true);
expect_type<Equal<TApp['/wrapped/[id]']['get']['out'], { wrapped: string }>>(true);
expect_type<Equal<TApp['/posts']['post']['in'], { title: string }>>(true);
expect_type<Equal<TApp['/posts/[id]/edit']['put']['out'], { id: string; title: string }>>(true);
expect_type<Equal<TApp['/admin/[user]']['get']['out'], { user: string }>>(true);
expect_type<Equal<TApp['/admin/[user]/[tab]']['get']['out'], { tab: string; user: string }>>(true);
expect_type<Equal<TApp['/gated/[id]']['get']['out'], { gated: string }>>(true);
expect_type<Equal<TApp['/out/[id]']['get']['out'], { id: string; outside: true }>>(true);
const _params: TApp['/posts/[id]']['params'] = { id: '1' };

routes({
	// @ts-expect-error — the key has no `slug`: a strict param, not an indexable record
	'/strict/[id]': { GET: (c) => c.params.slug.length },
	// @ts-expect-error — the wrapper is strict the same way
	'/strict2/[id]': { GET: GET((c) => c.params.slug.length) }
});

const client = api<TApp>('http://x');
// typed returns + required params + schema-typed body
const _r1: Promise<{ id: string; title: string }> = client.get('/posts/[id]', {
	params: { id: '1' }
});
const _r2: Promise<{ created: string }> = client.post('/posts', { body: { title: 'hi' } });
const _r4: Promise<{ tab: string; user: string }> = client.get('/admin/[user]/[tab]', {
	params: { user: 'u', tab: 't' }
});
// a Response-returning endpoint types unknown
const _r3: Promise<unknown> = client.get('/raw');
// @ts-expect-error — page paths carry no verbs, the client rejects them
client.get('/');
// @ts-expect-error — params are REQUIRED when the pattern has any
client.get('/posts/[id]');
// @ts-expect-error — the body must match the schema output
client.post('/posts', { body: { wrong: true } });

// THE KEY TYPES A PAGE'S LOAD AND ACTIONS the same way: strict `c.params`, bare or wrapped, top
// level, under nested layouts, behind `when()`; the load's return still reaches `$infer` as is.
import { load, action, type Load } from '../src/index.ts';
const pick = { __ogpick: () => C };
const keyedPages = routes({
	'/kp/[id]': page(C, {
		load: (c) => {
			expect_type<Equal<typeof c.params, { id: string }>>(true);
			return { post: c.params.id };
		},
		actions: { save: (c) => ({ saved: c.params.id }) }
	}),
	'/kw/[id]': page(C, {
		load: load((c) => ({ wrapped: c.params.id })),
		actions: { save: action((c) => ({ saved: c.params.id })) }
	}),
	'/kd/[...rest]': page(C, { load: (c) => ({ rest: c.params.rest }) }),
	'/[[lang]]/kl': page(C, { load: (c) => ({ lang: c.params.lang }) }),
	...admin({
		...deep({
			'/ka/[a]/[b]': page(C, { load: load((c) => ({ a: c.params.a, b: c.params.b })) })
		})
	}),
	'/kg/[id]': when(
		() => true,
		page(C, { load: (c) => ({ gated: c.params.id }), actions: { go: (c) => c.params.id } })
	),
	// the other component slots: a pick, a streamed page
	'/kpick/[id]': page(pick, { load: (c) => ({ picked: c.params.id }) }),
	'/kstream/[id]': page(
		async function* () {
			yield 'x';
		},
		{ load: (c) => ({ streamed: c.params.id }) }
	),
	// a `params` schema wins over the key; a `search` schema types `c.search`
	'/ks/[id]': page(C, {
		params: NumId,
		search: NumId as unknown as StandardSchemaV1<{ q: number }>,
		load: (c) => {
			expect_type<Equal<typeof c.params, { id: number }>>(true);
			expect_type<Equal<typeof c.search, { q: number }>>(true);
			return { n: c.params.id };
		}
	}),
	'/ksw/[id]': page(C, { params: NumId, load: load((c) => ({ n: c.params.id })) })
});
type KApp = typeof keyedPages.$infer;
expect_type<Equal<KApp['/kp/[id]']['data'], { post: string }>>(true);
expect_type<Equal<KApp['/kp/[id]']['form'], { saved: string } | null>>(true);
expect_type<Equal<KApp['/kw/[id]']['data'], { wrapped: string }>>(true);
expect_type<Equal<KApp['/kw/[id]']['form'], { saved: string } | null>>(true);
expect_type<Equal<KApp['/kd/[...rest]']['data'], { rest: string }>>(true);
expect_type<Equal<KApp['/[[lang]]/kl']['data'], { lang: string | undefined }>>(true);
expect_type<Equal<KApp['/ka/[a]/[b]']['data'], { a: string; b: string }>>(true);
expect_type<Equal<KApp['/kg/[id]']['data'], { gated: string }>>(true);
expect_type<Equal<KApp['/kg/[id]']['form'], string | null>>(true);
expect_type<Equal<KApp['/kpick/[id]']['data'], { picked: string }>>(true);
expect_type<Equal<KApp['/kstream/[id]']['data'], { streamed: string }>>(true);
expect_type<Equal<KApp['/ks/[id]']['data'], { n: number }>>(true);
expect_type<Equal<KApp['/ks/[id]']['params'], { id: number }>>(true);
expect_type<Equal<KApp['/ksw/[id]']['data'], { n: number }>>(true);
expect_type<Equal<KApp['/kp/[id]']['params'], { id: string }>>(true);

// A page built OUTSIDE a table stays loose (indexable params), and still fits any key.
const loosePage = page(C, {
	load: (c) => {
		expect_type<Equal<typeof c.params, { [x: string]: string | undefined }>>(true);
		return { any: c.params.whatever };
	}
});
const otherLoad: Load<'/other/[slug]'> = (c) => c.params.slug;
routes({
	'/loose/[id]': loosePage,
	// @ts-expect-error — the key has no `slug`: a page's load reads strict params too
	'/kbad1/[id]': page(C, { load: (c) => c.params.slug }),
	// @ts-expect-error — and its actions
	'/kbad2/[id]': page(C, { actions: { x: (c) => c.params.slug } }),
	// @ts-expect-error — the `load()` wrapper is strict the same way
	'/kbad3/[id]': page(C, { load: load((c) => c.params.slug) }),
	// @ts-expect-error — the `action()` wrapper too
	'/kbad4/[id]': page(C, { actions: { x: action((c) => c.params.slug) } }),
	// @ts-expect-error — behind `when()`
	'/kbad5/[id]': when(() => true, page(C, { load: (c) => c.params.slug })),
	...admin({
		// @ts-expect-error — inside a layout's table
		'/kbad6/[id]': page(C, { load: (c) => c.params.slug })
	}),
	// @ts-expect-error — a load typed for another route does not fit this key
	'/kbad7/[id]': page(C, { load: otherLoad })
});

// Merged cascade: shell load ∧ page load.
const _home: App['/']['data'] = { user: 'x', featured: ['a'] };
// Schema-coerced params (number, not string).
const _postParams: App['/post/[id]']['params'] = { id: 5 };
// @ts-expect-error — params.id is number
const _bad: App['/post/[id]']['params'] = { id: 'str' };
// Action return → form (nullable).
const _form: App['/login']['form'] = { ok: true };
const _noForm: App['/login']['form'] = null;
// Typed search.
const _search: App['/search']['search'] = { q: 'x' };
// Nested layout: shell ∧ section data.
const _docData: App['/docs/[slug]']['data'] = { user: 'x', nav: ['a'], doc: 'y' };
// Layout keys.
const _shell: App['(app)']['data'] = { user: 'x' };
const _section: App['(docs)']['data'] = { user: 'x', nav: ['a'] };

void [_home, _postParams, _bad, _form, _noForm, _search, _docData, _shell, _section];
