import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import { content_leaks } from '../src/vite/leaks.ts';

type Hook = (this: unknown, ...args: unknown[]) => void;
const call = (
	plugin: Plugin,
	hook: 'configResolved' | 'writeBundle',
	ctx: unknown,
	...args: unknown[]
) => (plugin[hook] as Hook).call(ctx, ...args);

const client = { environment: { name: 'client', config: { consumer: 'client' } } };
const ssr = { environment: { name: 'ssr', config: { consumer: 'server' } } };

function built(command: 'build' | 'serve' = 'build', routes = '/app/src/routes') {
	const plugin = content_leaks(() => routes);
	call(plugin, 'configResolved', null, { root: '/app', command, build: { ssr: false } });
	return plugin;
}

const chunk = (fileName: string, moduleIds: string[]) => ({ type: 'chunk', fileName, moduleIds });

function warnings(): unknown[][] {
	const out: unknown[][] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void out.push(a));
	return out;
}

afterEach(() => vi.restoreAllMocks());

describe('the content-leak guardrail, in the content plugin', () => {
	it('a compiled document in a client chunk is reported with its path, its CSS face is not', () => {
		const out = warnings();
		call(
			built(),
			'writeBundle',
			client,
			{},
			{
				'a.js': chunk('_app/immutable/chunks/a.js', [
					'/app/src/content/docs/intro.md',
					'/app/src/content/docs/intro.md?svelte&type=style&lang.css',
					'/app/src/lib/Island.svelte'
				]),
				'b.css': { type: 'asset', fileName: 'b.css' }
			}
		);
		const text = out.flat().join('\n');
		expect(text).toContain('content_leaked_to_client');
		expect(text).toContain('src/content/docs/intro.md');
		expect(text).toContain('_app/immutable/chunks/a.js');
		expect(text).not.toContain('type=style');
	});

	it('a markdown route page (+page.svx, +layout.md) in its own client node is the page, not a collection: nothing is said', () => {
		const out = warnings();
		call(
			built(),
			'writeBundle',
			client,
			{},
			{
				'13.js': chunk('_app/immutable/nodes/13.js', [
					'/app/src/routes/markdown/+page.svx',
					'/app/src/routes/(docs)/+layout@.md',
					'/app/src/routes/+error.svx'
				])
			}
		);
		expect(out).toEqual([]);
	});

	it("a collection's document named like a route page (+page.md) outside the routes folder is a leak, said; one under kit.files.routes is the page", () => {
		const out = warnings();
		call(
			built(),
			'writeBundle',
			client,
			{},
			{
				'a.js': chunk('_app/immutable/chunks/a.js', [
					'/app/src/content/docs/intro/+page.md',
					'/app/src/routes-old/+layout.svx'
				])
			}
		);
		const text = out.flat().join('\n');
		expect(text).toContain('src/content/docs/intro/+page.md');
		expect(text).toContain('src/routes-old/+layout.svx');
		out.length = 0;
		call(
			built('build', '/app/app/pages'),
			'writeBundle',
			client,
			{},
			{ '13.js': chunk('_app/immutable/nodes/13.js', ['/app/app/pages/docs/+page.svx']) }
		);
		expect(out).toEqual([]);
	});

	it('the server leg, a dev server and a clean client bundle say nothing', () => {
		const out = warnings();
		const docs = { 'a.js': chunk('a.js', ['/app/src/content/docs/intro.svx']) };
		call(built(), 'writeBundle', ssr, {}, docs);
		call(built('serve'), 'writeBundle', client, {}, docs);
		call(
			built(),
			'writeBundle',
			client,
			{},
			{
				'a.js': chunk('a.js', ['/app/src/lib/Island.svelte'])
			}
		);
		expect(out).toEqual([]);
	});
});
