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
