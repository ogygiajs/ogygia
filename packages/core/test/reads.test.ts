import { afterEach, describe, expect, it } from 'vitest';
import { note_visitor_read, open_reads, read_set, set_open_reads } from '../src/plugin/reads.ts';

afterEach(() => set_open_reads(null));

describe('read sets', () => {
	it('a read lands in its own set and in every set around it; the first one names each', () => {
		const page = read_set();
		const hole = read_set(page);
		const inner = read_set(hole);
		page.visitor('flag:hero');
		inner.visitor('cookie:session');
		expect(inner.perVisitor).toBe('cookie:session');
		expect(hole.perVisitor).toBe('cookie:session');
		expect(page.perVisitor).toBe('flag:hero');
	});

	it('a page.data read lands in every set around it', () => {
		const page = read_set();
		const hole = read_set(page);
		hole.page();
		expect(hole.pageData).toBe(true);
		expect(page.pageData).toBe(true);
	});

	it("a read with no work running lands in the request's set; under work, in both", () => {
		const request = read_set();
		note_visitor_read(request, 'header:authorization');
		expect(request.perVisitor).toBe('header:authorization');

		const other = read_set();
		const work = read_set();
		set_open_reads(() => work);
		note_visitor_read(other, 'cookie:x');
		expect(work.perVisitor).toBe('cookie:x');
		expect(other.perVisitor).toBe('cookie:x');
	});

	it('two module instances of this file (a plugin package and core) share the running set', async () => {
		const copy = (await import(
			// @ts-expect-error -- `?copy` loads a second instance of the module; TypeScript has no declaration for the query
			'../src/plugin/reads.ts?copy'
		)) as typeof import('../src/plugin/reads.ts');
		expect(copy.open_reads).not.toBe(open_reads);
		const work = read_set();
		set_open_reads(() => work);
		expect(copy.open_reads()).toBe(work);
	});
});
