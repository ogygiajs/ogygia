// A FRAME ADDRESS names the request a hole's answer answers: the endpoint's path and every parameter
// that says what is asked, whatever the endpoint. Only the capability's own parameters (its expiry,
// MAC, key, lifetime, a renewal flag) are left out: they change per mint, and the call does not.
// A plugin's endpoint once had no `id`, so every one of them was the address of its bare path, and
// two deferred peer widgets on one page showed one answer (#914).
import { describe, expect, it } from 'vitest';
import { frameAddress } from '../src/frame.ts';

const frag = (search: string, tail = 'exp=100&sig=abc') =>
	`/og/frag?peer=dash&kind=widget&target=kpis&search=${encodeURIComponent(search)}&${tail}`;
const hole = (id: string, props: string, tail = 'exp=100&sig=abc&k=k1') =>
	`/__ogygia__?id=${id}&props=${props}&${tail}`;

describe('frame address', () => {
	it('two plugin holes alike but for their props are two addresses', () => {
		expect(frameAddress(frag('org=acme'))).not.toBe(frameAddress(frag('org=globex')));
	});

	it('two plugin holes alike but for their target are two addresses', () => {
		expect(frameAddress(frag('').replace('kpis', 'holder'))).not.toBe(frameAddress(frag('')));
	});

	it('two endpoints with the same parameters are two addresses', () => {
		expect(frameAddress('/a/__ogygia__?id=x&props=p')).not.toBe(
			frameAddress('/b/__ogygia__?id=x&props=p')
		);
	});

	it('the same call minted again is the same address', () => {
		expect(frameAddress(frag('org=acme', 'exp=200&sig=def'))).toBe(frameAddress(frag('org=acme')));
		expect(frameAddress(hole('x', 'p', 'exp=200&ttl=60&sig=def&k=k2'))).toBe(
			frameAddress(hole('x', 'p'))
		);
	});

	it('a renewal (its parameters written again, without the flag) is the same address', () => {
		const url = new URL(frag('org=a b/c'), 'https://shell.example');
		url.searchParams.set('exp', '300');
		expect(frameAddress(`${url.pathname}?${url.searchParams}`)).toBe(
			frameAddress(frag('org=a b/c'))
		);
		expect(frameAddress(`${frag('org=acme')}&renew=1`)).toBe(frameAddress(frag('org=acme')));
	});

	it('an endpoint resolved against its page is the same address as written', () => {
		expect(frameAddress(`https://shell.example${hole('x', 'p')}`)).toBe(
			frameAddress(hole('x', 'p'))
		);
	});

	it("a region's copies, and its page facts, are each their own address", () => {
		expect(frameAddress(hole('x', 'p1'))).not.toBe(frameAddress(hole('x', 'p2')));
		expect(frameAddress(hole('x', 'p', 'pv=1&exp=1&sig=s'))).not.toBe(
			frameAddress(hole('x', 'p', 'pv=2&exp=1&sig=s'))
		);
	});
});
