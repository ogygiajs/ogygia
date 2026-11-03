// THE BUILD'S LOCATION MAP (runtime/entry-locations.ts `read_build_map`), in a real browser. A load
// that arrives with an identity alone (a region the browser rendered, a held region from the wire, a
// portable snippet with no graph) used to import the identity — the stable-name shim, which a cache
// can hold from another build. The runtime's script names the build's map; the first such load
// reads it and imports the location instead.
//
// Its own file: the map is read once per document, and module state is shared by a file's tests.
import { expect, test } from 'vitest';
import {
	entry_location,
	import_entry,
	note_entry_location
} from '../../src/runtime/entry-locations.ts';

const DIR = '/test/browser/fixtures/';
const abs = (u: string) => new URL(u, location.href).href;
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));

// the runtime's script, as the server writes it (server/document-tail.ts `runtime_bootstrap_tags`)
const script = document.createElement('script');
script.setAttribute('data-ogygia-runtime', '');
script.setAttribute('data-og-locations', DIR + 'og-locations.test.json');
document.head.append(script);

test('an identity alone loads its location from the build’s map, and the map is read once', async () => {
	// (a location the page itself wrote, a later build's, is kept: the map only fills gaps)
	note_entry_location(DIR + 'entry-page-written.ts', DIR + 'entry-located.ts');

	const m = await import_entry<{ default: string }>(DIR + 'entry-identity.ts');
	expect(m.default).toBe('located');
	expect(entry_location(DIR + 'entry-identity.ts')).toBe(abs(DIR + 'entry-located.ts'));
	expect(requested('entry-identity.ts')).toHaveLength(0);

	expect(entry_location(DIR + 'entry-page-written.ts')).toBe(abs(DIR + 'entry-located.ts'));

	await import_entry(DIR + 'entry-located.ts'); // a miss the map does not name: loads itself
	expect(requested('og-locations.test.json')).toHaveLength(1);
});
