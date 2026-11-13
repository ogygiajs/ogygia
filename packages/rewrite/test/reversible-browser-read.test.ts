// mark() reads the page the way the browser does (#1370): a quote inside an unquoted value or an
// attribute name opens nothing, a comment ends where the browser ends it, a noscript's text holds
// no element, and every quoting of a value is read.
import { describe, expect, it } from 'vitest';
import { mark } from '../src/reversible.ts';

const doc = (body: string) =>
	`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const marked = (body: string) => mark(doc(body), 'document', false)?.html ?? null;

describe('mark reads tags as the browser does', () => {
	it('a quote inside an unquoted value does not hide the host after it', () => {
		for (const lead of [`<p title=it's>x</p>`, `<p it's>x</p>`, `<p title="a>b" x=it's>x</p>`])
			expect(marked(`${lead}<demo-card>hi</demo-card>`), lead).toContain('<demo-card og-u="0">');
	});

	it('a comment ends at `--!>` and `<!-->` too', () => {
		for (const c of ['<!-- a --!>', '<!-->', '<!--->'])
			expect(marked(`${c}<demo-card>hi</demo-card><!-- -->`), c).toContain('<demo-card og-u="0">');
	});

	it('a host inside a noscript is text, not an element', () => {
		const out = marked('<noscript><demo-card>x</demo-card></noscript><demo-card>y</demo-card>')!;
		expect(out).toContain('<noscript><demo-card>x</demo-card></noscript>');
		expect(out).toContain('<demo-card og-u="0">y');
	});

	it('a region’s attributes in any quoting place its hosts', () => {
		for (const wake of ['wake="none"', "wake='none'", 'wake=none', 'WAKE = "none"'])
			expect(
				marked(`<ogygia-region ${wake}><demo-card>a</demo-card></ogygia-region>`),
				wake
			).toContain('<demo-card og-u="0">');
	});
});
