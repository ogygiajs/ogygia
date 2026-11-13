import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { router_link, slots } from '../src/runtime/slots.ts';

it('a lazy chunk that runs before its boot linked it says so loudly, by its code and the link', () => {
	const kept = slots.router_link;
	slots.router_link = null;
	try {
		expect(() => router_link()).toThrow(
			'[ogygia] https://ogygiajs.dev/e/slot_not_linked?name=router_link'
		);
	} finally {
		slots.router_link = kept;
	}
});

it('the slot registry imports no messages module: every chunk imports the registry', () => {
	const source = readFileSync(new URL('../src/runtime/slots.ts', import.meta.url), 'utf8');
	const imports = [...source.matchAll(/^import\s(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(
		(m) => m[1]
	);
	expect(imports.length).toBeGreaterThan(0);
	for (const from of imports) expect(from, from).not.toMatch(/messages/);
});
