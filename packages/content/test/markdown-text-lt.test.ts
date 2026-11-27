// A `<` in prose that starts no tag is text, as CommonMark reads it (`if the file is < 512KB`):
// the page compiles and shows the character. A real tag, a component and a `{…}` expression stay
// what they are.
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/plugin/utils';
import { ogygiaPreprocess } from '../src/markdown/index.ts';

async function page(md: string): Promise<string> {
	const out = (await ogygiaPreprocess().markup!({ content: md, filename: '/app/a.md' })) as {
		code: string;
	};
	return out.code;
}

function compiles(code: string): void {
	expect(() => compile(code, { generate: 'server', filename: 'a.svelte' })).not.toThrow();
}

describe('a bare < in markdown prose', () => {
	it('before a space is text: the page compiles and shows it', async () => {
		const code = await page('Keep the GIF if it is < 512KB, else convert it.\n');
		compiles(code);
		expect(code).toContain('<p>Keep the GIF if it is &lt; 512KB, else convert it.</p>');
	});

	it('before a digit is text too', async () => {
		const code = await page('I <3 this.\n');
		compiles(code);
		expect(code).toContain('<p>I &lt;3 this.</p>');
	});

	it('before a letter is left as written, since it can start a tag', async () => {
		const code = await page('a <b and c too.\n');
		expect(code).toContain('<p>a <b and c too.</p>');
	});

	it('an inline component whose expression has a space stays a component', async () => {
		const code = await page('A <Badge count={n + 1}/> here\n');
		compiles(code);
		expect(code).toContain('<p>A <Badge count={n + 1}/> here</p>');
	});

	it('an inline component whose expression holds a < stays a component', async () => {
		const code = await page('text <Foo bar={1 < 2}/> more\n');
		compiles(code);
		expect(code).toContain('<p>text <Foo bar={1 < 2}/> more</p>');
	});

	it('an inline component with children and a < in its handler compiles', async () => {
		const code = await page('inline <Foo on={() => a < b}>kid</Foo> end\n');
		compiles(code);
		expect(code).toContain('<p>inline <Foo on={() => a < b}>kid</Foo> end</p>');
	});

	it('a < inside a quoted attribute of an inline component is the attribute text', async () => {
		const code = await page('a <Foo title="x < y" n={n + 1}/> b < c\n');
		compiles(code);
		expect(code).toContain('x < y');
		expect(code).toContain(' n={n + 1}/> b &lt; c</p>');
	});

	it('a real tag, a component and an expression are left as they are', async () => {
		const code = await page('a <span>x</span> b < c {1 < 2} &lt; d\n');
		compiles(code);
		expect(code).toContain('<p>a <span>x</span> b &lt; c {1 < 2} &lt; d</p>');
	});

	it('inside a heading and a list item', async () => {
		const code = await page(dedent`
			## Sizes < 1 MB

			- under < 10
		`);
		compiles(code);
		expect(code).toContain('Sizes &lt; 1 MB');
		expect(code).toContain('<li>under &lt; 10</li>');
	});
});
