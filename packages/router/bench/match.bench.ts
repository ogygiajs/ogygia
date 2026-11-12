// Route matching and planning: compiling and ordering a route table, matching every request
// against it (static, params, optional and rest segments, a miss that falls to the catch-all),
// filling a pattern for every link, and the per-request context.
import { bench } from '@bench/heisenbench/bench';
import { make_ctx } from '../src/ctx.ts';
import { compile_all, fill, match_path } from '../src/match.ts';

const SECTIONS = [
	'docs',
	'blog',
	'shop',
	'account',
	'admin',
	'api',
	'help',
	'news',
	'team',
	'jobs'
];

/** A route table like a large app's: per section a static index, items, nested resources. */
function patterns(sections: number): string[] {
	const out = ['/', '/about', '/[[lang]]/search'];
	for (let s = 0; s < sections; s++) {
		const name = `${SECTIONS[s % SECTIONS.length]}${s < SECTIONS.length ? '' : s}`;
		out.push(
			`/${name}`,
			`/${name}/new`,
			`/${name}/[id]`,
			`/${name}/[id].json`,
			`/${name}/[id]/edit`,
			`/${name}/[id]/comments/[comment]`,
			`/${name}/[id]/files/[...path]`,
			`/[[lang]]/${name}/archive/[year]/[month]`,
			`/${name}/tags/[tag]`,
			`/${name}/feed.xml`
		);
	}
	out.push('/[...all]');
	return out;
}

/** Requests across the table, misses included (they fall through to the catch-all). */
function requests(sections: number): string[] {
	const out: string[] = [];
	for (let s = 0; s < sections; s++) {
		const name = `${SECTIONS[s % SECTIONS.length]}${s < SECTIONS.length ? '' : s}`;
		out.push(
			`/${name}`,
			`/${name}/item-${s}`,
			`/${name}/${s}.json`,
			`/${name}/${s}/comments/c%20${s}`,
			`/${name}/${s}/files/a/b/c.txt`,
			`/fr/${name}/archive/2026/09`,
			`/${name}/nope/nope/nope/nope`
		);
	}
	return out;
}

bench('compile_all: a 300-route table', ({ list }) => compile_all(list).length, {
	setup: () => ({ list: patterns(30) })
});

bench(
	'match_path: every request against a 300-route table',
	({ table, paths }) => {
		let hits = 0;
		for (const p of paths) if (match_path(table, p)) hits++;
		return hits;
	},
	{
		setup: () => ({ table: compile_all(patterns(30)), paths: requests(30) }),
		scale: (_ctx, k) => ({ table: compile_all(patterns(30 * k)), paths: requests(30) })
	}
);

bench(
	'fill: the href of every link on a page',
	({ links }) => {
		let n = 0;
		for (const [pattern, params] of links) n += fill(pattern, params).length;
		return n;
	},
	{
		setup: () => ({
			links: Array.from({ length: 300 }, (_, i): [string, Record<string, string | number>] => [
				i % 3 === 0
					? '/shop/[id]/comments/[comment]'
					: i % 3 === 1
						? '/docs/[id]/files/[...path]'
						: '/[[lang]]/blog/archive/[year]/[month]',
				{ id: `item ${i}`, comment: i, path: `a/b/${i}`, lang: 'en', year: 2026, month: i % 12 }
			])
		})
	}
);

bench(
	'make_ctx: the context of a request with a query string',
	({ url, request }) => {
		const c = make_ctx({ id: '42' }, url, request, undefined, (p) => p, '/shop/[id]');
		return c.state;
	},
	{
		setup: () => {
			const url = new URL(
				`https://example.test/shop/42?${Array.from({ length: 40 }, (_, i) => `f${i}=v${i}`).join('&')}&f1=dup`
			);
			return { url, request: new Request(url) };
		}
	}
);
