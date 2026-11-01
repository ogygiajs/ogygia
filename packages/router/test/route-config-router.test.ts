/**
 * ROUTE CONFIG × the programmatic router — `page(C, { config })` / `layout(name, C, { config })` /
 * `routes(table, { config })` merge like Kit's `config` (table, then layouts outermost → innermost,
 * then the page; later wins, top level only), registered with the generic route-config registry the
 * handle consults (core's plugin/routes.ts). Matcher grammar: `undefined` = not this table's · an
 * object = claimed, with its merged config. A claiming table SHADOWS the file world even when its
 * config lacks the key: dispatch would answer from the table, never from a Kit page.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { routes, page, layout } from '../src/index.ts';
import {
	routeConfig as route_config,
	clearRouteConfig as clear_route_config,
	setPageRouteConfig as set_page_route_config
} from '@ogygia/core/plugin/testing';

const C = (() => null) as never;
const postrender = (path: string) => route_config('postrender', null, path);

beforeEach(() => clear_route_config());

describe('route config × programmatic router', () => {
	it('a page that sets nothing and an unmatched path both answer undefined (the default applies)', () => {
		routes({ '/a': page(C) });
		expect(postrender('/a')).toBe(undefined);
		expect(postrender('/nope')).toBe(undefined);
	});

	it('a claimed-but-unset path shadows the file world; an unclaimed one falls through to it', () => {
		set_page_route_config({ '/a': { postrender: true }, '/kit': { postrender: true } });
		routes({ '/a': page(C) });
		expect(route_config('postrender', '/a', '/a')).toBe(undefined); // the table claims /a
		expect(route_config('postrender', '/kit', '/kit')).toBe(true); // nobody claims /kit
	});

	it('page > layout > table — the deepest level wins', () => {
		const shell = layout('shell', C, { config: { postrender: true } });
		routes(
			{
				...shell({
					'/on': page(C),
					'/off': page(C, { config: { postrender: false } })
				}),
				'/tbl': page(C)
			},
			{ config: { postrender: false } }
		);
		expect(postrender('/on')).toBe(true); // from the layout
		expect(postrender('/off')).toBe(false); // the page overrides its layout
		expect(postrender('/tbl')).toBe(false); // the table's
	});

	it('nested layouts: the innermost wins over an outer one', () => {
		const outer = layout('outer', C, { config: { postrender: false } });
		const inner = layout('inner', C, { config: { postrender: true } });
		routes({ ...outer({ ...inner({ '/x': page(C) }) }) });
		expect(postrender('/x')).toBe(true);
	});

	it('the merge is per key: a deeper config without the key keeps the outer value', () => {
		const shell = layout('shell', C, { config: { postrender: false } });
		routes({ ...shell({ '/x': page(C, { config: { runtime: 'edge' } }) }) });
		expect(postrender('/x')).toBe(false);
		expect(route_config('runtime', null, '/x')).toBe('edge');
	});

	it('a `base` is stripped before matching; a path outside it is not this table’s', () => {
		routes({ '/p': page(C, { config: { postrender: true } }) }, { base: '/r' });
		expect(postrender('/r/p')).toBe(true);
		expect(postrender('/p')).toBe(undefined);
	});

	it('dynamic patterns match like dispatch', () => {
		routes({ '/docs/[slug]': page(C, { config: { postrender: true } }) });
		expect(postrender('/docs/intro')).toBe(true);
	});

	it('endpoints are not pages: claimed, nothing set, whatever the table says', () => {
		routes({ '/api': { GET: () => new Response('x') } as never }, { config: { postrender: true } });
		expect(postrender('/api')).toBe(undefined);
	});

	it('re-registering the same table REPLACES its matcher (dev re-evaluation), never shadows it', () => {
		routes({ '/a': page(C, { config: { postrender: false } }) });
		routes({ '/a': page(C, { config: { postrender: true } }) });
		expect(postrender('/a')).toBe(true);
	});

	it('two mounted tables: the one that claims the path answers', () => {
		routes({ '/a': page(C, { config: { postrender: true } }) }, { base: '/one' });
		routes({ '/a': page(C, { config: { postrender: false } }) }, { base: '/two' });
		expect(postrender('/one/a')).toBe(true);
		expect(postrender('/two/a')).toBe(false);
	});
});
