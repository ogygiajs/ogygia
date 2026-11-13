// Code from an origin the page does not load code from is refused with the whole message, before any
// lazy chunk linked the boot's: the refusal is boot code, with the boot's own message table.
import { expect, test } from 'vitest';
import { code_url_or_refuse } from '../../src/runtime/code-origins.ts';

test('a refusal before anything linked the boot still says what was refused and why', () => {
	expect(() => code_url_or_refuse('https://elsewhere.example/x.js', '/island.js')).toThrow(
		'refused island code from https://elsewhere.example/x.js (for /island.js): not an origin this page loads code from'
	);
});
