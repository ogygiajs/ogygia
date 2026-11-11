// capability(): a signed, expiring, addressed token. What it promises, each proved: a token checks
// only for the audience, fields, name and version it was minted for; its lifetime is clamped and a
// longer one is refused; any changed part is refused; with replay on, a nonce checks once and a full
// memory refuses new tokens rather than forgetting a live one; a NaN clock mints and checks nothing.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { capability, type Signer } from '../src/index.ts';

/** A keyed stand-in signer (runs in every engine; the module never looks inside a signature):
 *  two FNV-1a passes over key and message, as 16 hex characters each. */
const hmac = (key: string): Signer => {
	const fnv = (s: string, seed: number) => {
		let h = seed >>> 0;
		for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
		return h.toString(16).padStart(8, '0');
	};
	const sign = (m: string) =>
		fnv(key + '\0' + m, 2166136261) + fnv(m + '\0' + key, 84696351) + fnv(key + m, 1) + fnv(m, 7);
	return { sign, verify: (m, sig) => sign(m) === sig };
};

function setup(o: { replay?: number; key?: string; name?: string; version?: number } = {}) {
	let t = 1_000_000;
	const cap = capability({
		name: o.name ?? 'region',
		version: o.version ?? 1,
		signer: hmac(o.key ?? 'k'),
		ttl: { min: 1_000, max: 60_000 },
		replay: o.replay ? { max: o.replay } : undefined,
		now: () => t
	});
	return { cap, at: (ms: number) => (t = ms), later: (ms: number) => (t += ms) };
}

const AUD = 'https://app.example';

describe('capability: what checks', () => {
	it('a token checks for its audience and fields, until it expires', () => {
		const { cap, later } = setup();
		const token = cap.mint(AUD, ['id1', 'props'], 10_000);
		expect(cap.check(token, AUD, ['id1', 'props'])).toMatchObject({ ok: true });
		later(9_999);
		expect(cap.check(token, AUD, ['id1', 'props']).ok).toBe(true);
		later(1);
		expect(cap.check(token, AUD, ['id1', 'props'])).toEqual({ ok: false, why: 'expired' });
	});

	it('another audience, field, name, version or key is refused', () => {
		const { cap } = setup();
		const token = cap.mint(AUD, ['a', 'b'], 10_000);
		expect(cap.check(token, 'https://other.example', ['a', 'b'])).toEqual({
			ok: false,
			why: 'sig'
		});
		expect(cap.check(token, AUD, ['a', 'c'])).toEqual({ ok: false, why: 'sig' });
		expect(cap.check(token, AUD, ['a'])).toEqual({ ok: false, why: 'sig' });
		expect(setup({ name: 'federation' }).cap.check(token, AUD, ['a', 'b']).ok).toBe(false);
		expect(setup({ version: 2 }).cap.check(token, AUD, ['a', 'b'])).toEqual({
			ok: false,
			why: 'version'
		});
		expect(setup({ key: 'other' }).cap.check(token, AUD, ['a', 'b'])).toEqual({
			ok: false,
			why: 'sig'
		});
	});

	it('fields cannot trade text across a boundary', () => {
		const { cap } = setup();
		const token = cap.mint(AUD, ['a|1:b', 'c'], 10_000);
		expect(cap.check(token, AUD, ['a', 'b|1:c']).ok).toBe(false);
		expect(cap.message(AUD, 1, 'n', ['a|1:b', 'c'])).not.toBe(
			cap.message(AUD, 1, 'n', ['a', 'b|1:c'])
		);
	});

	it('any changed character of a token is refused', () => {
		const { cap } = setup();
		const token = cap.mint(AUD, ['x'], 10_000);
		fc.assert(
			fc.property(fc.nat(), fc.constantFrom(...'0123456789abcdefv._-AZ'), (at, ch) => {
				const i = at % token.length;
				const changed = token.slice(0, i) + ch + token.slice(i + 1);
				fc.pre(changed !== token);
				expect(cap.check(changed, AUD, ['x']).ok).toBe(false);
			}),
			{ numRuns: 400 }
		);
	});
});

describe('capability: lifetime', () => {
	it('a mint is clamped to [min, max]; a token claiming more than max is refused', () => {
		const { cap, at } = setup();
		at(0);
		const long = cap.mint(AUD, [], 10 ** 12);
		expect(Number(long.split('.')[1])).toBe(60_000);
		const short = cap.mint(AUD, [], 0);
		expect(Number(short.split('.')[1])).toBe(1_000);
		// (a far expiry under a valid-looking signature: refused before any signature work)
		const parts = long.split('.');
		parts[1] = String(10 ** 9);
		expect(cap.check(parts.join('.'), AUD, [])).toEqual({ ok: false, why: 'lifetime' });
	});

	it('a NaN clock mints nothing and checks nothing; a NaN ttl mints nothing', () => {
		let t = 0;
		const cap = capability({
			name: 'n',
			version: 1,
			signer: hmac('k'),
			ttl: { max: 10 },
			now: () => t
		});
		const token = cap.mint(AUD, [], 5);
		t = Number.NaN;
		expect(() => cap.mint(AUD, [], 5)).toThrow(/machine_bad_time/);
		expect(() => cap.check(token, AUD, [])).toThrow(/machine_bad_time/);
		t = 0;
		expect(() => cap.mint(AUD, [], Number.NaN)).toThrow(/machine_bad_option/);
	});
});

describe('capability: replay', () => {
	it('with replay, a nonce checks once; without, as often as presented', () => {
		const once = setup({ replay: 10 }).cap;
		const t1 = once.mint(AUD, [], 10_000);
		expect(once.check(t1, AUD, []).ok).toBe(true);
		expect(once.check(t1, AUD, [])).toEqual({ ok: false, why: 'replayed' });
		const many = setup().cap;
		const t2 = many.mint(AUD, [], 10_000);
		for (let i = 0; i < 3; i++) expect(many.check(t2, AUD, []).ok).toBe(true);
	});

	it('a full memory refuses a new token, never forgets a live one; an expired one makes room', () => {
		const { cap, later } = setup({ replay: 2 });
		const a = cap.mint(AUD, [], 5_000);
		const b = cap.mint(AUD, [], 20_000);
		const c = cap.mint(AUD, [], 20_000);
		expect(cap.check(a, AUD, []).ok).toBe(true);
		expect(cap.check(b, AUD, []).ok).toBe(true);
		expect(cap.check(c, AUD, [])).toEqual({ ok: false, why: 'full' });
		expect(cap.check(a, AUD, [])).toEqual({ ok: false, why: 'replayed' });
		later(5_000);
		expect(cap.check(c, AUD, []).ok).toBe(true);
		expect(cap.check(b, AUD, [])).toEqual({ ok: false, why: 'replayed' });
	});
});

describe('capability: options', () => {
	it('refuses a missing audience, name, version or bounds with a coded error', () => {
		const signer = hmac('k');
		expect(() => capability({ name: '', version: 1, signer, ttl: { max: 1 } })).toThrow(
			/machine_bad_option/
		);
		expect(() => capability({ name: 'n', version: 0, signer, ttl: { max: 1 } })).toThrow(
			/machine_bad_option/
		);
		expect(() => capability({ name: 'n', version: 1, signer, ttl: { max: Infinity } })).toThrow(
			/machine_bad_option/
		);
		expect(() => capability({ name: 'n', version: 1, signer, ttl: { max: 5, min: 9 } })).toThrow(
			/machine_bad_option/
		);
		expect(() =>
			capability({ name: 'n', version: 1, signer, ttl: { max: 5 }, replay: { max: 0 } })
		).toThrow(/machine_bad_option/);
		const cap = capability({ name: 'n', version: 1, signer, ttl: { max: 5 } });
		expect(() => cap.mint('', [], 1)).toThrow(/machine_bad_option/);
		expect(() => cap.check('v1.1.x.y', '', [])).toThrow(/machine_bad_option/);
	});

	it('refuses a signer whose signature is not URL-safe', () => {
		const cap = capability({
			name: 'n',
			version: 1,
			signer: { sign: () => 'a.b/c+d=e=f=g=h=i', verify: () => true },
			ttl: { max: 5 }
		});
		expect(() => cap.mint(AUD, [], 1)).toThrow(/machine_bad_option/);
	});
});
