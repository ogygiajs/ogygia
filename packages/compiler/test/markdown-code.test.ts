// A markdown page's code (a fence, a code span) is text, not Svelte: mdsvex escapes its braces, so a
// macro call written there is a sample, not a call. The compiler's markdown reading is checked against
// mdsvex itself, the preprocessor that compiles the page: a `{call}` is an expression exactly when
// mdsvex's output keeps it as one.
import { compile } from 'mdsvex';
import { describe, expect, it } from 'vitest';
import { run_module_macros, type MacroPipelineCtx } from '../src/macros/pipeline.ts';
import { markdown_expressions, markdown_scripts } from '../src/parse/scan.ts';
import type { Profiler } from '../src/driver.ts';

const NO_PROFILE = { P: false } as unknown as Profiler;
const CALL = `import.meta.og.image(hero)`;
const EXPR = `{${CALL}}`;
const F = '```';

/** Each page holds one `{call}`; the name says where. */
const PAGES: Readonly<Record<string, string>> = {
	'a fence inside a list item': `1. Read the image:\n\n    ${F}svelte\n    <Img of=${EXPR} />\n    ${F}\n`,
	'a fence two lists deep': `- a\n  - b\n\n        ${F}\n        ${EXPR}\n        ${F}\n`,
	'a tab-indented fence in a list item': `- a\n\n\t${F}\n\t${EXPR}\n\t${F}\n`,
	'a fence indented four spaces after a paragraph': `Text\n\n    ${F}\n    ${EXPR}\n    ${F}\n`,
	'a fence indented eight spaces': `Text\n\n        ${F}\n        ${EXPR}\n        ${F}\n`,
	'a tab-indented fence after a component line and a blank line': `<Tabs>\n\n\t${F}svelte\n\t${EXPR}\n\t${F}\n\n</Tabs>\n`,
	'a fence in a block quote': `> ${F}\n> ${EXPR}\n> ${F}\n`,
	'a fence opened on a list marker line': `- ${F}\n  ${EXPR}\n  ${F}\n`,
	'a fence that is never closed': `${F}\n${EXPR}\n`,
	'a tilde fence': `~~~\n${EXPR}\n~~~\n`,
	'a fence right after a paragraph line': `Text\n${F}\n${EXPR}\n${F}\n`,
	'a fence inside an {#if} block': `{#if true}\n${F}\n${EXPR}\n${F}\n{/if}\n`,
	'a code span over two lines': `A \`code\nspan ${EXPR}\` here\n`,
	'a code span over two lines of a list item': `- a \`b\n  ${EXPR}\` c\n`,
	'a code span continued lazily in a block quote': `> a \`b\n${EXPR}\`\n`,
	'a double-backtick span holding a backtick': `\`\`a \` ${EXPR} b\`\`\n`,
	'a code span in a heading': `# a \`${EXPR}\`\n`,
	'a code span inside inline HTML': `a <b>\`${EXPR}\`</b>\n`,
	'markup indented four spaces (mdsvex has no indented code)': `Text\n\n    <Img of=${EXPR} />\n`,
	'markup indented under a component, after a blank line': `<div>\n\n    ${EXPR}\n\n</div>\n`,
	'a tab-indented fence inside a component line block': `<Tabs>\n\t${F}svelte\n\t${EXPR}\n\t${F}\n</Tabs>\n`,
	'a fence inside an HTML block with no blank line': `<div>\n${F}\n${EXPR}\n${F}\n</div>\n`,
	'a fence after an <img> line': `<img src="x">\n${F}\n${EXPR}\n${F}\n`,
	'a backtick fence whose info holds a backtick (no fence)': `${F} a\`b\n${EXPR}\n${F}\n`,
	'a fence closed less indented than it opened': `    ${F}\n    x\n${F}\n${EXPR}\n`,
	'a code span cut by a blank line (no span)': `\`a\n\n${EXPR}\`\n`,
	'an escaped backtick (no span)': `\\\`${EXPR}\`\n`,
	'a fence written in an HTML comment': `<!--\n${F}\n-->\n${EXPR}\n`,
	'a fence and a backtick on a component line': `<Tabs>${F}\n${EXPR}\n${F}</Tabs>\n`,
	'plain prose': `Hello ${EXPR}\n`
};

async function mdsvex_keeps(page: string): Promise<boolean> {
	const out = await compile(page, {});
	return out!.code.includes(EXPR);
}

describe("a markdown page's code regions are the ones mdsvex escapes", () => {
	for (const [name, page] of Object.entries(PAGES))
		it(`${name}: a call there is an expression exactly when mdsvex keeps it`, async () => {
			const kept = await mdsvex_keeps(page);
			expect(markdown_expressions(page).some((r) => r.code === CALL)).toBe(kept);
		});

	it('the pages cover both answers', async () => {
		const answers = await Promise.all(Object.values(PAGES).map(mdsvex_keeps));
		expect(answers).toContain(true);
		expect(answers).toContain(false);
	});

	it("a <script> written in a list item's fence is no script block", () => {
		const page = `1. Add:\n\n    ${F}svelte\n    <script>\n    \tconst hero = ${CALL};\n    </script>\n    ${F}\n`;
		expect(markdown_scripts(page)).toEqual([]);
	});

	it("a docs step's fenced sample inside a list item fails no build, with or without image()", async () => {
		const page = `1. Read the image:\n\n    ${F}svelte\n    <Img of={${CALL}} />\n    ${F}\n`;
		const base: MacroPipelineCtx = {
			root: '/app',
			alias: [],
			pkgRoot: '/og',
			dollarHoists: new Map(),
			ownSource: () => true,
			markdownExts: ['.svx']
		};
		const image = { name: 'image', handler: (code: string) => code };
		for (const ctx of [base, { ...base, macros: [image] }])
			expect(await run_module_macros(page, '/app/src/routes/+page.svx', ctx, NO_PROFILE)).toEqual({
				code: page,
				touched: false,
				maps: []
			});
	});
});
