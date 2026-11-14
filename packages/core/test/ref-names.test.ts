/**
 * THE NAMES OF ONE RENDER (ref.ts RefNames): a server request names each stateful ref it mints by
 * its fence (random per request) and its place (the order it first minted it). An island's
 * fingerprint reads the place only, so the same page rendered twice gives its islands the same
 * `data-og-fp` (#804), and two answers in one tab never share an id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ref_names, set_ref_names_reader, placed, type RefNames } from '../src/ref.ts';
import { __register_transportable, wire } from '../src/live-transport.ts';
import { PropsWire } from '../src/server/props-wire.ts';
import { region_fingerprint } from '../src/server/fingerprint.ts';

class Stamp {
	label: string;
	constructor(label = '') {
		this.label = label;
	}
	static [wire] = {
		encode: (s: Stamp) => s.label,
		decode: (label: string) => new Stamp(label)
	};
}
__register_transportable('src/stamp.ts#Stamp', Stamp);

/** Runs `fn` as one server request: its own names. */
function request<T>(fn: (names: RefNames) => T): { out: T; names: RefNames } {
	const names = ref_names();
	set_ref_names_reader(() => names);
	try {
		return { out: fn(names), names };
	} finally {
		set_ref_names_reader(null);
	}
}

/** A page: one island whose props carry a fresh instance, rendered in one request. */
const render_page = () => {
	const w = new PropsWire({ stamp: new Stamp('kept'), label: 'near' }, '/islands/c.js');
	return { fp: region_fingerprint('/islands/c.js', w.canonical), text: w.wire(null).text };
};

afterEach(() => set_ref_names_reader(null));

describe('ref names · one per render', () => {
	it('an island with a wire-class prop has the same fingerprint on every server render (#804)', () => {
		const a = request(render_page);
		const b = request(render_page);
		expect(b.out.fp).toBe(a.out.fp);
	});

	it('two renders never share an id: each wire text carries its own fence', () => {
		const a = request(render_page);
		const b = request(render_page);
		expect(a.out.text).toContain(`${a.names.fence}~0`);
		expect(b.out.text).toContain(`${b.names.fence}~0`);
		expect(a.names.fence).not.toBe(b.names.fence);
	});

	it('one instance is one id in a render; two instances are two, so two islands never share by accident', () => {
		const { out } = request(() => {
			const shared = new Stamp('s');
			const one = new PropsWire({ stamp: shared }, '/islands/c.js');
			const two = new PropsWire({ stamp: shared }, '/islands/c.js');
			const other = new PropsWire({ stamp: new Stamp('s') }, '/islands/c.js');
			return { one, two, other };
		});
		expect(out.two.wire(null).text).toBe(out.one.wire(null).text);
		// equal data, another instance: another place, so another fingerprint (and its own sidecar)
		expect(out.other.canonical).not.toBe(out.one.canonical);
	});

	it('placed() drops the fence of the render minting now, and leaves other text alone', () => {
		const other = ref_names();
		const { names, out } = request((own) => [
			placed(`a${other.fence}~0`),
			placed(`a${own.fence}~1`)
		]);
		expect(out).toEqual([`a${other.fence}~0`, 'a~1']);
		// off a request: no names, nothing to drop
		expect(placed(`a${names.fence}~1`)).toBe(`a${names.fence}~1`);
	});
});
