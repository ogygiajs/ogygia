import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url);

const IMPORT_RE =
	/^(?:import|export)\s[^;]*?from\s+'(\.{1,2}\/[^']+)'|^[^*/\n]*\bimport\('(\.{1,2}\/[^']+)'\)/gm;

function reached_from(entry: string): Set<string> {
	const seen = new Set<string>();
	const next = [new URL(entry, SRC).href];
	while (next.length > 0) {
		const file = next.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		const text = readFileSync(new URL(file), 'utf8');
		for (const m of text.matchAll(IMPORT_RE)) next.push(new URL(m[1] ?? m[2], file).href);
	}
	return new Set([...seen].map((href) => href.slice(SRC.href.length)));
}

describe('@ogygia/machine/testing: a test-only entry', () => {
	it('the runtime entry never imports it', () => {
		const runtime = reached_from('index.ts');
		expect(runtime.has('decisions.ts')).toBe(true);
		expect(runtime.has('testing.ts')).toBe(false);
	});

	it('is its own export, in the workspace and in the published package', () => {
		const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		expect(pkg.exports['./testing']).toEqual({
			types: './dist/testing.d.ts',
			default: './src/testing.ts'
		});
		expect(pkg.publishConfig.exports['./testing']).toEqual({
			types: './dist/testing.d.ts',
			default: './dist/testing.js'
		});
	});
});
