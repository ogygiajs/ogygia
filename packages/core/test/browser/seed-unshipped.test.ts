// SEED SHAPING'S ORACLE IN THE BROWSER (rules builds and dev, runtime/seeds.ts): a shaped page seed
// names the keys it left out; island code reading one of them is told to the rules
// (`rule_seed_key_unshipped`), a key the seed carries or never had is not.
import { afterEach, expect, it } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { page_seed_of } from '../../src/runtime/seeds.ts';

link_boot();

const MARK = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const heard: string[] = [];
const g = globalThis as { __og_unshipped_read?: (key: string) => void };
const before = g.__og_unshipped_read;
g.__og_unshipped_read = (key) => heard.push(key);
afterEach(() => {
	heard.length = 0;
});

/** A next document whose server seed ships `data` and names `left` as left out. */
function next_document(data: Record<string, unknown>, left: string[] | string | null) {
	const doc = document.implementation.createHTMLDocument('next');
	const runtime = doc.createElement('script');
	runtime.setAttribute('data-ogygia-runtime', '');
	runtime.setAttribute('data-og-mark', MARK);
	runtime.type = 'application/x-runtime-stand-in';
	doc.head.prepend(runtime);
	const seed = doc.createElement('script');
	seed.type = 'application/ogygia-page';
	seed.setAttribute('data-og-format', 'json');
	seed.setAttribute('data-og-mark', MARK);
	if (left)
		seed.setAttribute(
			'data-ogygia-page-unshipped',
			typeof left === 'string' ? left : JSON.stringify(left)
		);
	seed.textContent = JSON.stringify({ data });
	doc.body.append(seed);
	return doc;
}

it('a read of a key the shaped seed left out is told; a shipped or unknown key is not', () => {
	const data = page_seed_of(next_document({ kept: 1 }, ['secret']))!.data as Record<
		string,
		unknown
	>;
	expect(data.kept).toBe(1);
	expect(data.other).toBeUndefined();
	expect(heard).toEqual([]);
	expect(data.secret).toBeUndefined();
	expect(heard).toEqual(['secret']);
	// the object is still the seed's: its own keys, nothing added
	expect(Object.keys(data)).toEqual(['kept']);
});

it('a left-out list that does not parse names nothing: the seed still reads, and nothing is told', () => {
	const data = page_seed_of(next_document({ kept: 1 }, '["secret'))!.data as Record<
		string,
		unknown
	>;
	expect(data.kept).toBe(1);
	expect(data.secret).toBeUndefined();
	expect(heard).toEqual([]);
});

it('a seed shipped whole names nothing, and nothing is told', () => {
	const data = page_seed_of(next_document({ kept: 1 }, null))!.data as Record<string, unknown>;
	expect(data.secret).toBeUndefined();
	expect(heard).toEqual([]);
	g.__og_unshipped_read = before;
});
