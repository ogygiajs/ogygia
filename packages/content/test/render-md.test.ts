// `import.meta.og.md(text)` renders static prose; anything that would have to run is a build error.
import { describe, expect, it } from 'vitest';
import { render_markdown } from '../src/markdown/render-md.ts';
import { dedent } from '@ogygia/core/plugin/utils';

const code_of = async (p: Promise<unknown>): Promise<string | undefined> => {
	try {
		await p;
	} catch (e) {
		return (e as { code?: string }).code;
	}
	return undefined;
};

describe('md() component tags', () => {
	for (const text of [
		'<Foo />',
		'Some prose, then <Foo /> inline.',
		'<Foo>child</Foo>',
		'<ui.Button />',
		`${dedent`
			# Title

			<Widget label="x" />
		`}\n`
	]) {
		it(`a component tag is a coded build error: ${JSON.stringify(text)}`, async () => {
			expect(await code_of(render_markdown(null, text))).toBe('content_md_dynamic');
		});
	}

	it('a component tag inside inline code or a fence is text, not an error', async () => {
		const inline = await render_markdown(null, 'Use `<Foo />` here.');
		expect(inline).toContain('&lt;Foo');
		const fence = await render_markdown(
			null,
			`${dedent`
			\`\`\`svelte
			<Foo />
			\`\`\`
		`}\n`
		);
		expect(fence).toContain('Foo');
	});

	it('plain html tags and prose stay static', async () => {
		const html = await render_markdown(null, 'Hello <em>there</em>, <kbd>Ctrl</kbd>.');
		expect(html).toContain('<em>there</em>');
	});
});
