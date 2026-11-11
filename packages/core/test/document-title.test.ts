// `document()`'s `title` option fills a gap only: the head's own <title> wins, read as a browser
// reads the head.
import { describe, expect, it } from 'vitest';
import { document } from '../src/document.ts';
import { region } from '../src/region.ts';
import Tiny from './_fixtures/Tiny.svelte';

const head_of = async (res: Response) => {
	const html = await res.text();
	return html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
};

describe('document() title', () => {
	it('the option fills a head that has no title', async () => {
		const res = await document(region(Tiny as never, { n: 1 } as never), { title: 'T' });
		expect(await head_of(res)).toContain('<title>T</title>');
	});

	it('the head’s own title wins, in any case', async () => {
		const res = await document(region(Tiny as never, { n: 1 } as never), {
			title: 'T',
			head: '<TITLE>Own</TITLE>'
		});
		expect(await head_of(res)).not.toContain('<title>T</title>');
	});

	it('a title inside a comment is not the head’s title', async () => {
		const res = await document(region(Tiny as never, { n: 1 } as never), {
			title: 'T',
			head: '<!-- <title>old</title> -->'
		});
		expect(await head_of(res)).toContain('<title>T</title>');
	});
});
