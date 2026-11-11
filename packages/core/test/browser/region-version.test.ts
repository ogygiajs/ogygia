// A region answer carries the data version the app gave it (`region(C, props, { version })`), and
// the frame store orders answers at one address by that version first, by request ticket second.
// Two commands return the same region; the browser decodes their responses in either order.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ogygiaTransport } from '../../src/transport.ts';
import { frameAddress } from '../../src/frame.ts';
import * as frames from '../../src/runtime/frame-store.ts';

const { decode } = ogygiaTransport.Region;

const URL_ = '/__ogygia__?id=card&props=e30&exp=9999999999&sig=x';
const ADDRESS = frameAddress(URL_);

/** The wire form of `await region(Card, {}, { version })` as a command returns it. */
const answer = (html: string, version?: number) => ({
	i: 'card',
	p: {},
	u: URL_,
	m: '',
	x: html,
	...(version === undefined ? {} : { d: version })
});

/** Every frame the region's binder would have painted, in order. */
function painted(): string[] {
	const seen: string[] = [];
	frames.subscribe(ADDRESS, (f) => seen.push(f.html));
	return seen;
}

afterEach(() => frames._reset());

describe('two commands answer the same region', () => {
	it('the older version decoded last never paints over the newer one (#682)', () => {
		const seen = painted();
		decode(answer('<p>B</p>', 2)); // the later command's answer lands first
		decode(answer('<p>A</p>', 1)); // the earlier command's answer lands last
		expect(frames.peek(ADDRESS)?.html).toBe('<p>B</p>');
		expect(seen).toEqual(['<p>B</p>']);
	});

	it('the drop is said in dev, naming its code', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		decode(answer('<p>B</p>', 2));
		decode(answer('<p>A</p>', 1));
		const said = warn.mock.calls.map((c) => String(c[0]));
		warn.mockRestore();
		expect(said.some((s) => s.includes('region_answer_older'))).toBe(true);
	});

	it('a newer version decoded last paints', () => {
		const seen = painted();
		decode(answer('<p>A</p>', 1));
		decode(answer('<p>B</p>', 2));
		expect(seen).toEqual(['<p>A</p>', '<p>B</p>']);
	});

	it('equal versions: the one decoded last paints (same data, newest render)', () => {
		const seen = painted();
		decode(answer('<p>one</p>', 5));
		decode(answer('<p>two</p>', 5));
		expect(seen).toEqual(['<p>one</p>', '<p>two</p>']);
	});

	it('without versions, the one decoded last paints (as before)', () => {
		const seen = painted();
		decode(answer('<p>B</p>'));
		decode(answer('<p>A</p>'));
		expect(seen).toEqual(['<p>B</p>', '<p>A</p>']);
	});

	it('an unversioned answer after a versioned one paints, and the version it replaced no longer orders the next', () => {
		const seen = painted();
		decode(answer('<p>v3</p>', 3));
		decode(answer('<p>plain</p>'));
		decode(answer('<p>v1</p>', 1));
		expect(seen).toEqual(['<p>v3</p>', '<p>plain</p>', '<p>v1</p>']);
	});
});
