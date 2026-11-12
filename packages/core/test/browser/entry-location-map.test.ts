// THE BUILD'S LOCATION MAP (runtime/entry-locations.ts `read_build_map`), in a real browser. A load
// that arrives with an identity alone (a region the browser rendered, a held region from the wire, a
// portable snippet with no graph) imports its location: the runtime's script names the build's map,
// and the first such load reads it.
//
// Its own file: the map is read once per document, and module state is shared by a file's tests.
import { expect, test } from 'vitest';
import {
	entry_location,
	import_entry,
	note_entry_location,
	pin_build_map
} from '../../src/runtime/entry-locations.ts';

const DIR = '/test/browser/fixtures/';
const abs = (u: string) => new URL(u, location.href).href;
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));

// the runtime's script, as the server writes it (server/document-tail.ts `runtime_bootstrap_tags`),
// its map RELATIVE to the page (Kit's default `paths.relative`)
const page = location.pathname;
const depth = page.split('/').length - 2; // the page's directories below the root
const script = document.createElement('script');
script.setAttribute('data-ogygia-runtime', '');
script.setAttribute(
	'data-og-locations',
	`${depth > 0 ? '../'.repeat(depth) : './'}${DIR.slice(1)}og-locations.test.json`
);
document.head.append(script);
pin_build_map(); // the runtime's boot, before any navigation

test('read after a navigation moved the address: the map is the one the page named, and is read once', async () => {
	// a client navigation to another depth before the first identity-only load: unpinned, the map's
	// relative address would resolve against this one and name a file that is not there
	history.pushState(null, '', '/a/deeper/page/');
	try {
		// (a location the page itself wrote, a later build's, is kept: the map only fills gaps)
		const written = `${DIR}ogygia/og-region.0000000000c3.js`;
		note_entry_location(written, `${DIR}immutable/og-region.0000000000c3.New.js`);

		const identity = `${DIR}ogygia/og-region.0000000000c1.js`;
		const m = await import_entry<{ default: string }>(identity);
		expect(m.default).toBe('located');
		expect(entry_location(identity)).toBe(abs(`${DIR}immutable/og-region.0000000000c1.Loc.js`));
		expect(requested('ogygia/og-region.0000000000c1.js')).toHaveLength(0);

		expect(entry_location(written)).toBe(abs(`${DIR}immutable/og-region.0000000000c3.New.js`));

		await import_entry(`${DIR}entry-located.ts`); // a miss the map does not name: loads itself
		expect(requested('og-locations.test.json')).toHaveLength(1);
	} finally {
		history.pushState(null, '', page);
	}
});
