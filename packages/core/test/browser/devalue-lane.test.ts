// DEVALUE, LOADED WHEN A PAGE NEEDS IT (runtime/devalue-lane.ts). A page whose side-channel scripts are
// all in the JSON lane never downloads devalue; the first devalue-lane read waits for its import, which
// starts beside the load that leads there.
//
// Its own file: whether devalue is loaded is module state shared by a file's tests.
import { expect, test } from 'vitest';
import {
	devalue,
	load_devalue,
	needs_devalue,
	with_devalue
} from '../../src/runtime/devalue-lane.ts';
import { stringify } from 'devalue';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

test('only a script in the devalue lane needs devalue', () => {
	const json =
		'<script type="application/ogygia-props" data-ogygia-props="a" data-og-format="json">{}</script>';
	expect(needs_devalue(doc(json))).toBe(false);
	expect(needs_devalue(doc('<p>no islands</p>'))).toBe(false);
	expect(
		needs_devalue(
			doc('<script type="application/ogygia-props" data-ogygia-props="a">[{}]</script>')
		)
	).toBe(true);
	expect(needs_devalue(doc('<script type="application/ogygia-page">[{}]</script>'))).toBe(true);
	expect(
		needs_devalue(doc('<script type="application/ogygia-page" data-og-format="json">{}</script>'))
	).toBe(false);
	expect(needs_devalue(doc('<script type="application/ogygia-page-facts">[{}]</script>'))).toBe(
		true
	);
});

test('a read before the load says so; after it, devalue parses', async () => {
	expect(() => devalue()).toThrow(/e\/devalue_not_loaded/);
	const seen: unknown[] = [];
	with_devalue(
		({ parse }) => seen.push(parse(stringify(new Date(0)))),
		(error) => seen.push(error)
	);
	expect(seen).toEqual([]); // (queued: the import is still in flight)
	await load_devalue();
	await Promise.resolve();
	expect(seen).toEqual([new Date(0)]);
	expect(devalue().parse(stringify(new Map([[1, 2]])))).toEqual(new Map([[1, 2]]));
	with_devalue(
		({ parse }) => seen.push(parse(stringify(1))),
		(error) => seen.push(error)
	);
	expect(seen).toHaveLength(2); // (loaded: it runs at once)
});
