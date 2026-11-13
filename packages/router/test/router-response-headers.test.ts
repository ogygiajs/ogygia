import { describe, it, expect } from 'vitest';
import { routes } from '../src/index.ts';

const req = (path: string) => new Request(`http://x${path}`);

describe('c.json() and c.text() keep the headers they are given (#1759)', () => {
	const app = routes({
		'/json/headers': {
			GET: (c) => c.json({ ok: true }, { headers: new Headers({ 'x-a': '1' }) })
		},
		'/json/pairs': { GET: (c) => c.json({ ok: true }, { headers: [['x-a', '1']] }) },
		'/json/type': {
			GET: (c) => c.json({ ok: true }, { headers: { 'Content-Type': 'application/vnd.x+json' } })
		},
		'/text/headers': { GET: (c) => c.text('hi', { headers: new Headers({ 'x-a': '1' }) }) },
		'/text/pairs': { GET: (c) => c.text('hi', { headers: [['x-a', '1']] }) },
		'/text/type': { GET: (c) => c.text('<p>', { headers: { 'Content-Type': 'text/html' } }) }
	});

	it('a Headers object reaches the response, with the default content type', async () => {
		for (const [path, type] of [
			['/json/headers', 'application/json'],
			['/text/headers', 'text/plain; charset=utf-8']
		]) {
			const res = (await app.fetch(req(path)))!;
			expect(res.headers.get('x-a')).toBe('1');
			expect(res.headers.get('content-type')).toBe(type);
		}
	});

	it('header pairs reach the response by name, not by index', async () => {
		for (const path of ['/json/pairs', '/text/pairs']) {
			const res = (await app.fetch(req(path)))!;
			expect(res.headers.get('x-a')).toBe('1');
			expect(res.headers.has('0')).toBe(false);
		}
	});

	it("the caller's content type replaces the default, whatever its case", async () => {
		expect((await app.fetch(req('/json/type')))!.headers.get('content-type')).toBe(
			'application/vnd.x+json'
		);
		expect((await app.fetch(req('/text/type')))!.headers.get('content-type')).toBe('text/html');
	});

	it('json keeps its no-store default next to the given headers', async () => {
		const res = (await app.fetch(req('/json/headers')))!;
		expect(res.headers.get('cache-control')).toBe('no-store');
	});
});
