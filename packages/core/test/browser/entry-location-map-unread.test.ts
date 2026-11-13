// THE BUILD'S LOCATION MAP when the network fails its read (runtime/entry-locations.ts
// `read_build_map`). Its own file: the map is read once per document, and module state is shared by
// a file's tests.
import { expect, test } from 'vitest';
import { entry_location, import_entry, pin_build_map } from '../../src/runtime/entry-locations.ts';

const DIR = '/test/browser/fixtures/';
const MAP = 'og-locations.test.json';

const script = document.createElement('script');
script.setAttribute('data-ogygia-runtime', '');
script.setAttribute('data-og-locations', `${DIR}${MAP}`);
document.head.append(script);
pin_build_map();

test('a map read the network failed is not kept: the load goes on as written, and the next identity-only load reads it again', async () => {
	const real = window.fetch;
	let asked = 0;
	window.fetch = (input, init) => {
		if (String(input instanceof Request ? input.url : input).includes(MAP) && asked++ === 0)
			return Promise.reject(new TypeError('Failed to fetch'));
		return real(input, init);
	};
	try {
		const identity = `${DIR}ogygia/og-region.0000000000c1.js`;
		const own = await import_entry<{ default: string }>(`${DIR}entry-located.ts`);
		expect(own).toBeDefined();
		expect(asked).toBe(1);
		expect(entry_location(identity)).toBeFalsy();
		const m = await import_entry<{ default: string }>(identity);
		expect(m.default).toBe('located');
		expect(asked).toBe(2);
	} finally {
		window.fetch = real;
	}
});
