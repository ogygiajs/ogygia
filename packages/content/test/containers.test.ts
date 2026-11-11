// `:::` containers (src/markdown/containers.ts) write the author's title into the .svx source as
// Svelte markup: it stays text, whatever it holds.
import { describe, expect, it } from 'vitest';
import { transform_containers } from '../src/markdown/containers.ts';

const title = (src: string) =>
	transform_containers(src).match(
		/<(?:p|summary) class="og-admonition-title">(.*)<\/(?:p|summary)>/
	)?.[1];

describe('a container title', () => {
	it('holding { } stays text: Svelte never reads it as an expression (#469)', () => {
		expect(title('::: tip Use {count} here\nbody\n:::')).toBe('Use &#123;count&#125; here');
		expect(title('::: details {open}\nbody\n:::')).toBe('&#123;open&#125;');
	});

	it('holding markup characters stays text', () => {
		expect(title('::: warning a <b> & "c"\nbody\n:::')).toBe('a &lt;b&gt; &amp; "c"');
	});

	it('with none falls back to the kind’s label', () => {
		expect(title('::: tip\nbody\n:::')).toBe('TIP');
	});
});

describe('a container', () => {
	it('written tight (no blank lines) still gets blank lines around its body, so Markdown renders inside', () => {
		expect(transform_containers('::: tip\n**bold**\n:::')).toBe(
			[
				'',
				'<div class="og-admonition og-admonition-tip" role="note">',
				'<p class="og-admonition-title">TIP</p>',
				'',
				'**bold**',
				'',
				'</div>',
				''
			].join('\n')
		);
	});

	it('of an alias kind is styled as the kind it folds onto, under its own label', () => {
		const opened = (src: string) => transform_containers(src).split('\n')[1];
		expect(opened('::: note\nx\n:::')).toBe(
			'<div class="og-admonition og-admonition-info" role="note">'
		);
		expect(opened('::: caution\nx\n:::')).toBe(
			'<div class="og-admonition og-admonition-warning" role="note">'
		);
		expect(title('::: note\nx\n:::')).toBe('NOTE');
		expect(title('::: caution\nx\n:::')).toBe('CAUTION');
	});

	it('`details` is a collapsible <details> with a <summary> title', () => {
		const out = transform_containers('::: details More\nx\n:::');
		expect(out).toContain('<details class="og-admonition og-admonition-details">');
		expect(out).toContain('<summary class="og-admonition-title">More</summary>');
		expect(out).toContain('</details>');
	});

	it('inside fenced code is left as it is, whichever fence holds it', () => {
		for (const fence of ['```', '~~~']) {
			const src = [fence + 'md', '::: tip', 'x', ':::', fence].join('\n');
			expect(transform_containers(src)).toBe(src);
		}
		const mixed = ['~~~', '```', '::: tip', '~~~'].join('\n');
		expect(transform_containers(mixed)).toBe(mixed);
	});

	it('nested containers close in order; an open one the author never closed is closed at the end', () => {
		const out = transform_containers('::: details A\n::: warning\nINNER\n:::\nOUTER');
		expect(out.indexOf('</div>')).toBeGreaterThan(out.indexOf('INNER'));
		expect(out.indexOf('</div>')).toBeLessThan(out.indexOf('OUTER'));
		expect(out.indexOf('</details>')).toBeGreaterThan(out.indexOf('OUTER'));
	});
});
