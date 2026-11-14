import { describe, expect, it } from 'vitest';
import { context_keys } from '../src/link/context-detect.ts';
import { dedent } from '@ogygia/core/contract';

const keys = (src: string) => context_keys(src, 'script');

describe('a symbol context key is seen at build', () => {
	it('a getContext(Symbol.for(name)) read counts under the name the key crosses as', () => {
		const src = dedent`
			import { getContext } from 'svelte';
			const RT = Symbol.for('rt');
			getContext(RT);
			getContext(Symbol.for('b'));
		`;
		expect(keys(src).reads).toEqual(['\0srt', '\0sb']);
	});

	it('a setContext(Symbol.for(name)) counts as a set, so an island setting its own is not flagged', () => {
		const src = dedent`
			import { setContext } from 'svelte';
			setContext(Symbol.for('rt'), 1);
		`;
		expect(keys(src).sets).toEqual(['\0srt']);
	});

	it("ogygia's setContext with a one-off Symbol() key is flagged, inline or through a const", () => {
		const src = dedent`
			import { setContext } from 'ogygia';
			const K = Symbol('k');
			setContext(Symbol('rt'), 1);
			setContext(K, 2);
			setContext(Symbol.for('ok'), 3);
		`;
		expect(keys(src).one_off).toEqual(["Symbol('rt')", 'K']);
	});

	it("Svelte's own setContext with a one-off Symbol() is same-root and is not flagged", () => {
		const src = dedent`
			import { setContext } from 'svelte';
			setContext(Symbol('rt'), 1);
		`;
		expect(keys(src).one_off).toEqual([]);
	});

	it("a one-off Symbol() key ogygia's setContext keeps off the page with options is not flagged", () => {
		const src = dedent`
			import { setContext } from 'ogygia';
			setContext(Symbol('rt'), 1, { islands: false });
		`;
		expect(keys(src).one_off).toEqual([]);
	});
});
