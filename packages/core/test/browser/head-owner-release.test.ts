// A head tag a region wrote names its owning region (`data-og-owner`, the outermost island's
// fingerprint). After a navigation's swap, a tag the next page's head does not list stays while a
// region with that fingerprint is still on the page, and goes once none is (#806).
import { afterEach, describe, expect, it } from 'vitest';
import { release_head_nodes } from '../../src/runtime/region-sheets.ts';
import { connected_regions } from '../../src/runtime/connected.ts';
import { scope } from '@ogygia/machine';

const made: Element[] = [];
/** The test regions' lifetime in the page: each test's end ends it. */
let page = scope();

function region(fp: string): Element {
	const el = document.createElement('div');
	el.setAttribute('data-og-fp', fp);
	document.body.append(el);
	connected_regions.add(el, page);
	made.push(el);
	return el;
}

function stamp(owner: string | null): Element {
	const meta = document.createElement('meta');
	meta.setAttribute('name', 'ogygia-kit-island');
	meta.setAttribute('content', '/e.js');
	if (owner !== null) meta.setAttribute('data-og-owner', owner);
	document.head.append(meta);
	made.push(meta);
	return meta;
}

afterEach(() => {
	page.close();
	page = scope();
	for (const el of made.splice(0)) el.remove();
});

describe('release_head_nodes', () => {
	it('keeps a tag whose owning region is still on the page', () => {
		region('fp-kept');
		const meta = stamp('fp-kept');
		release_head_nodes([meta]);
		expect(meta.isConnected).toBe(true);
	});

	it('takes out a tag whose owning region left the page', () => {
		const gone = region('fp-gone');
		const meta = stamp('fp-gone');
		gone.remove(); // (out of the document; its teardown has not run yet)
		release_head_nodes([meta]);
		expect(meta.isConnected).toBe(false);
	});

	it('a tag several islands own stays while any is on the page; its list keeps those on it (#854)', () => {
		region('fp-b');
		const meta = stamp('fp-a fp-b fp-c');
		release_head_nodes([meta]);
		expect(meta.isConnected).toBe(true);
		expect(meta.getAttribute('data-og-owner')).toBe('fp-b');
		// (listed by the next page and owned by none on it: its first owner stays named)
		const listed = stamp('fp-x fp-y');
		release_head_nodes([]);
		expect(listed.isConnected).toBe(true);
		expect(listed.getAttribute('data-og-owner')).toBe('fp-x');
	});

	it('takes out an unlisted tag that names no owner', () => {
		region('fp-kept');
		const meta = stamp(null);
		release_head_nodes([meta]);
		expect(meta.isConnected).toBe(false);
	});
});
