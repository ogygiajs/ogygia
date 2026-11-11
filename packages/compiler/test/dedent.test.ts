import { describe, expect, it } from 'vitest';
import { dedent } from '../src/compiler/dedent.ts';

describe('dedent as a tag', () => {
	it('strips the template’s own indent and the edge lines', () => {
		const out = dedent`
			export const a = 1;
				export const b = 2;
		`;
		expect(out).toBe('export const a = 1;\n\texport const b = 2;');
	});

	it('a value spanning lines never decides the indent', () => {
		const block = 'x,\ny';
		expect(dedent`
			const list = [
				${block}
			];
		`).toBe('const list = [\n\tx,\ny\n];');
	});

	it('values go in as a template literal would, in order', () => {
		expect(dedent`
			${1} ${'two'} ${null}
		`).toBe('1 two null');
	});

	it('called with a string, it is the plain dedent', () => {
		expect(dedent('\n    a\n      b\n')).toBe('a\n  b');
	});
});
