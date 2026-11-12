// RESPONSE-MARK, the server's half (server/response-mark.ts): one random mark per response, the same
// on every ask for one request, so the head runtime script and each side channel of the response
// carry one mark; and the holes record carries it (server/document-tail.ts). The client half is
// test/browser/side-channel-seeds.test.ts.
import { describe, expect, it } from 'vitest';
import { mark_attr, response_mark } from '../src/server/response-mark.ts';
import { DocumentTail } from '../src/server/document-tail.ts';

describe('the response mark', () => {
	it('is one mark per request, the same on every ask', () => {
		const request = new Request('https://example.com/');
		const mark = response_mark(request);
		expect(mark).toMatch(/^[0-9a-f]{24}$/);
		expect(response_mark(request)).toBe(mark);
		expect(mark_attr(request)).toBe(` data-og-mark="${mark}"`);
	});

	it('differs between requests, so no response can carry another one’s', () => {
		const marks = new Set<string>();
		for (let i = 0; i < 200; i++) marks.add(response_mark(new Request('https://example.com/')));
		expect(marks.size).toBe(200);
	});

	it('is written on the holes record', () => {
		const t = new DocumentTail();
		t.hole('aaaaaaaaaaaaaaaa', '/__ogygia__?id=a', '');
		const request = new Request('https://example.com/');
		expect(t.render(null, false, mark_attr(request))).toContain(
			`<script type="application/ogygia-holes" data-ogygia-holes data-og-mark="${response_mark(request)}">`
		);
	});
});
