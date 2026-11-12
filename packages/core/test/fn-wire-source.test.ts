// A FUNCTION CROSSES BY ITS BUILD TAG, NEVER BY ITS SOURCE. An og.$ function travels as its tag and
// its bound captures; whoever decodes it finds the factory in the build's own table (the registry the
// generated modules fill, or the page's manifest). Text on the wire is data: a payload that carries a
// function's source for a tag the table lacks is refused, and the source is never run — on the
// server (SvelteKit parses a remote function's argument with the app's transport), or anywhere.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as devalue from 'devalue';
import { ogygiaTransport } from '../src/transport.ts';
import { ref_reviver, REF_WIRE_KEY } from '../src/ref.ts';
import { register_fn_kind } from '../src/fn-transport.ts';

// SvelteKit's own remote-argument parser (what its remote endpoint runs on `?payload=` / a body)
const kit_root = path.dirname(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
const { parse_remote_arg } = (await import(
	pathToFileURL(path.join(kit_root, 'src/runtime/shared.js')).href
)) as { parse_remote_arg: (s: string, transport: unknown) => unknown };

const RAN = '__og_fn_wire_source_ran';
const ran = () => (globalThis as Record<string, unknown>)[RAN] === true;
afterEach(() => {
	delete (globalThis as Record<string, unknown>)[RAN];
});

/** A payload whose `fn` ref names a tag no build registered, with source beside it. */
function unregistered_fn_text(key: string): string {
	const marker = {};
	return devalue.stringify(marker, {
		[key]: (v: unknown) =>
			v === marker
				? {
						k: 'fn',
						i: 'x',
						t: 'no-such-tag#$0',
						d: { s: `(globalThis.${RAN} = true, () => () => 0)`, b: [] }
					}
				: undefined
	});
}

describe('a function on the wire is its tag, never its source', () => {
	it('a remote function argument naming an unknown function tag is refused, its source never run', () => {
		const arg = Buffer.from(unregistered_fn_text('OgygiaRef'), 'utf8').toString('base64url');
		expect(() => parse_remote_arg(arg, { ...ogygiaTransport })).toThrow(/fn_revive_missing/);
		expect(ran()).toBe(false);
	});

	it('the fn kind revives only from the build’s table, wherever a ref is decoded', () => {
		register_fn_kind();
		expect(() =>
			devalue.parse(unregistered_fn_text(REF_WIRE_KEY), {
				[REF_WIRE_KEY]: ref_reviver(false)
			} as Parameters<typeof devalue.parse>[1])
		).toThrow(/fn_revive_missing/);
		expect(ran()).toBe(false);
	});
});
