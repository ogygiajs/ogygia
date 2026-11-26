// `<Img>` writes ogygia's own attribute names in its markup and its scoped CSS, where a JS constant
// cannot be named (a spread would change the SSR output). This keeps them equal to core's markup
// vocabulary, so a rename on one side turns red here instead of drifting.
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { MARK, OG_IMG } from '@ogygia/core/internal/server';

const source = fs.readFileSync(new URL('../src/Img.svelte', import.meta.url), 'utf8');

test("every data-og-* name <Img> writes is one of core's markup names", () => {
	const known = new Set(Object.values(MARK).map((m) => m.attr));
	const written = new Set(source.match(/data-og-[a-z-]+/g) ?? []);
	expect(written.size).toBeGreaterThan(0);
	expect([...written].filter((name) => !known.has(name))).toEqual([]);
});

test("<Img>'s data-og-img is core's OG_IMG, in its markup and in its CSS", () => {
	expect(source).toContain(`${OG_IMG}={`);
	expect(source).toContain(`img[${OG_IMG}=`);
});
