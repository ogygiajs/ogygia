import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { request_scope } from '@ogygia/core/internal/server';
import { action, layout, load, page, routes, type Ctx } from '../src/index.ts';

const C = (() => {}) as unknown as Component<never>;
const ctx_for = (request: Request) => ({ request }) as unknown as Ctx;

describe('load() inside one request', () => {
	it('a failed load is the request’s failure: the next call in it gets the same, without a run', async () => {
		let runs = 0;
		const flaky = load(async () => {
			runs++;
			if (runs === 1) throw new Error('first try fails');
			return runs;
		});
		const c = ctx_for(new Request('http://x/'));
		await expect(flaky(c)).rejects.toThrow('first try fails');
		await expect(flaky(c)).rejects.toThrow('first try fails');
		expect(runs).toBe(1);
		// (a new request runs it again)
		expect(await flaky(ctx_for(new Request('http://x/')))).toBe(2);
	});

	it('refuses a load asked for after its request ended, with the reason the request ended', async () => {
		const request = new Request('http://x/');
		const l = load(async () => 'data');
		const owner = request_scope(request);
		owner.close();
		await expect(l(ctx_for(request))).rejects.toBe(owner.signal.reason);
	});
});

describe('layout()', () => {
	it('prepends itself to each page chain, outermost first, and passes endpoints through as they are', () => {
		const outer = layout('outer', C);
		const inner = layout('inner', C);
		const endpoint = { GET: () => new Response('ok') };
		const table = outer({ ...inner({ '/p': page(C) }), '/api': endpoint });
		expect(table['/p'].layouts.map((l) => l.name)).toEqual(['outer', 'inner']);
		expect(table['/api']).toBe(endpoint);
	});
});

describe('page() actions', () => {
	it('keeps an action() wrapper as it is and wraps a bare function', async () => {
		const wrapped = action(() => 'wrapped');
		const def = page(C, { actions: { a: wrapped, b: () => 'bare' } });
		expect(def.actions!.a).toBe(wrapped);
		expect(def.actions!.b.__ogaction).toBe(true);
		expect(await def.actions!.b({} as Ctx)).toBe('bare');
		routes({ '/p': def });
	});
});
