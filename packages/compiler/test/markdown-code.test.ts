// A markdown page's code (a fence, a code span) is text, not Svelte: mdsvex escapes its braces, so a
// macro call written there is a sample, not a call. The compiler's markdown reading is checked against
// mdsvex itself, the preprocessor that compiles the page: a `{call}` is an expression exactly when
// mdsvex's output keeps it as one.
import fc from 'fast-check';
import { compile } from 'mdsvex';
import { describe, expect, it } from 'vitest';
import { run_module_macros, type MacroPipelineCtx } from '../src/macros/pipeline.ts';
import { markdown_expressions, markdown_scripts } from '../src/parse/scan.ts';
import type { Profiler } from '../src/driver.ts';
import { dedent } from '@ogygia/core/contract';

const NO_PROFILE = { P: false } as unknown as Profiler;
const CALL = `import.meta.og.image(hero)`;
const EXPR = `{${CALL}}`;
const F = '```';

const PAGES: Readonly<Record<string, readonly string[]>> = {
	'a fence inside a list item': [
		'1. Read the image:',
		'',
		`    ${F}svelte`,
		`    <Img of=${EXPR} />`,
		`    ${F}`
	],
	'a fence two lists deep': ['- a', '  - b', '', `        ${F}`, `        ${EXPR}`, `        ${F}`],
	'a tab-indented fence in a list item': ['- a', '', `\t${F}`, `\t${EXPR}`, `\t${F}`],
	'a fence indented four spaces after a paragraph': [
		'Text',
		'',
		`    ${F}`,
		`    ${EXPR}`,
		`    ${F}`
	],
	'a fence indented eight spaces': ['Text', '', `        ${F}`, `        ${EXPR}`, `        ${F}`],
	'a tab-indented fence after a component line and a blank line': [
		'<Tabs>',
		'',
		`\t${F}svelte`,
		`\t${EXPR}`,
		`\t${F}`,
		'',
		'</Tabs>'
	],
	'a fence in a block quote': [`> ${F}`, `> ${EXPR}`, `> ${F}`],
	'a fence opened on a list marker line': [`- ${F}`, `  ${EXPR}`, `  ${F}`],
	'a fence that is never closed': [F, EXPR],
	'a tilde fence': ['~~~', EXPR, '~~~'],
	'a fence right after a paragraph line': ['Text', F, EXPR, F],
	'a fence inside an {#if} block': ['{#if true}', F, EXPR, F, '{/if}'],
	'a code span over two lines': ['A `code', `span ${EXPR}\` here`],
	'a code span over two lines of a list item': ['- a `b', `  ${EXPR}\` c`],
	'a code span continued lazily in a block quote': ['> a `b', `${EXPR}\``],
	'a double-backtick span holding a backtick': [`\`\`a \` ${EXPR} b\`\``],
	'a code span in a heading': [`# a \`${EXPR}\``],
	'a code span inside inline HTML': [`a <b>\`${EXPR}\`</b>`],
	'markup indented four spaces (mdsvex has no indented code)': [
		'Text',
		'',
		`    <Img of=${EXPR} />`
	],
	'markup indented under a component, after a blank line': [
		'<div>',
		'',
		`    ${EXPR}`,
		'',
		'</div>'
	],
	'a tab-indented fence inside a component line block': [
		'<Tabs>',
		`\t${F}svelte`,
		`\t${EXPR}`,
		`\t${F}`,
		'</Tabs>'
	],
	'a fence inside an HTML block with no blank line': ['<div>', F, EXPR, F, '</div>'],
	'a fence after an <img> line': ['<img src="x">', F, EXPR, F],
	'a backtick fence whose info holds a backtick (no fence)': [`${F} a\`b`, EXPR, F],
	'a fence closed less indented than it opened': [`    ${F}`, '    x', F, EXPR],
	'a code span cut by a blank line (no span)': ['`a', '', `${EXPR}\``],
	'an escaped backtick (no span)': [`\\\`${EXPR}\``],
	'a fence written in an HTML comment': ['<!--', F, '-->', EXPR],
	'a fence and a backtick on a component line': [`<Tabs>${F}`, EXPR, `${F}</Tabs>`],
	'plain prose': [`Hello ${EXPR}`]
};

const page_of = (rows: readonly string[]): string => `${rows.join('\n')}\n`;

async function mdsvex_keeps(page: string): Promise<boolean> {
	const out = await compile(page, {});
	return out!.code.includes(EXPR);
}

describe("a markdown page's code regions are the ones mdsvex escapes", () => {
	for (const [name, rows] of Object.entries(PAGES))
		it(`${name}: a call there is an expression exactly when mdsvex keeps it`, async () => {
			const page = page_of(rows);
			const kept = await mdsvex_keeps(page);
			expect(markdown_expressions(page).some((r) => r.code === CALL)).toBe(kept);
		});

	it('a page of blocks parted by blank lines (fences, spans, lists, quotes, components): a call is an expression exactly when mdsvex keeps one', async () => {
		const lead = fc.constantFrom<readonly [string, string]>(
			['', ''],
			['', ''],
			['    ', '    '],
			['\t', '\t'],
			['> ', '> '],
			['- ', '  '],
			['1. ', '   '],
			['  ', '  ']
		);
		const body = fc.constantFrom(
			'',
			'',
			[F, EXPR, F],
			[`${F}svelte`, `<Img of=${EXPR} />`, F],
			['~~~', 'text', EXPR, '~~~'],
			'text',
			`text ${EXPR}`,
			`a \`span ${EXPR}\` b`,
			'a `open',
			`${EXPR}\` close`,
			`<Img of=${EXPR} />`,
			'<Tabs>',
			'</Tabs>',
			'<div>',
			'</div>',
			'{#if a}',
			'{/if}'
		);
		const block = fc.tuple(lead, body).map(([[first, rest], b]) => {
			if (b === '') return '';
			if (typeof b === 'string') return first + b;
			const [open, more] = /^( {4}|\t)$/.test(first) ? ['', ''] : [first, rest];
			return b.map((row, i) => (i === 0 ? open : more) + row).join('\n');
		});
		await fc.assert(
			fc.asyncProperty(fc.array(block, { maxLength: 16 }), async (blocks) => {
				const page = page_of([blocks.join('\n\n')]);
				const out = await compile(page, {}).catch(() => null);
				fc.pre(out != null);
				const kept = out!.code.includes(EXPR);
				expect(markdown_expressions(page).some((r) => r.code === CALL)).toBe(kept);
			}),
			{ numRuns: 300 }
		);
	});

	it('known difference: a fence indented four columns outside any list never closes in mdsvex, so the page after it is code there; the compiler reads it closed, as CommonMark does', async () => {
		const page = page_of([`    ${F}`, '    x', `    ${F}`, '', `text ${EXPR}`]);
		expect(await mdsvex_keeps(page)).toBe(false);
		expect(markdown_expressions(page).map((r) => r.code)).toEqual([CALL]);
	});

	it('the pages cover both answers', async () => {
		const answers = await Promise.all(
			Object.values(PAGES).map((rows) => mdsvex_keeps(page_of(rows)))
		);
		expect(answers).toContain(true);
		expect(answers).toContain(false);
	});

	it("a <script> written in a list item's fence is no script block", () => {
		const page = dedent`
			1. Add:

			    ${F}svelte
			    <script>
			        const hero = ${CALL};
			    </script>
			    ${F}
		`;
		expect(markdown_scripts(page)).toEqual([]);
	});

	it("a docs step's fenced sample inside a list item fails no build, with or without image()", async () => {
		const page = dedent`
			1. Read the image:

			    ${F}svelte
			    <Img of={${CALL}} />
			    ${F}
		`;
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
