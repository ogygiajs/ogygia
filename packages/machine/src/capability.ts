/**
 * capability(): A SIGNED, EXPIRING, ADDRESSED TOKEN. One shape for every "the server said yes to
 * this, for whom, until when" in ogygia (a region's capability URL, a federation call, a profiler
 * window), so each signer stops hand-rolling the same fields and the same footguns:
 *
 * - the message is length-prefixed, field by field, so no field's text can move a boundary;
 * - it names the capability (`name`) and its `version`: a token for one never checks as another;
 * - it names an `audience` (who may present it), always: a token minted for one never checks for
 *   another;
 * - its lifetime is clamped to `[ttl.min, ttl.max]` at mint, and a token claiming more than
 *   `ttl.max` is refused at check (its expiry is signed, so only a forger could claim it);
 * - it carries a random nonce, and with `replay` each nonce checks once (remembered until it would
 *   have expired, at most `replay.max` at a time: past that, new tokens are refused, never an old
 *   one forgotten); with `nonce: false` it carries none, so the same inputs mint the same token
 *   (links that stay identical between renders), and such a token is never single-use;
 * - a clock that reads NaN mints nothing and checks nothing.
 *
 * The cryptography is the caller's `signer` (an HMAC, an Ed25519 key pair): this module never
 * imports a crypto library, so it runs in a browser, a server and an edge runtime alike.
 *
 *   const region = capability({ name: 'region', version: 3, signer, ttl: { max: 3_600_000 } });
 *   const token = region.mint('https://app.example', [id, props], 60_000);
 *   const r = region.check(token, 'https://app.example', [id, props]);   // { ok: true, exp, nonce }
 */
import { machine_error } from './messages.ts';

/** Signs and verifies one message. `sign`'s output is URL-safe (hex or base64url); `verify`
 *  compares in constant time. */
export interface Signer {
	sign(message: string): string;
	verify(message: string, sig: string): boolean;
}

/** Options for {@link capability}. */
export interface CapabilityOptions {
	/** What this capability is ("region", "federation.call"): part of every signed message. */
	name: string;
	/** A whole number from 1; part of every signed message, and the token's first field. */
	version: number;
	/** The cryptography: see {@link Signer}. */
	signer: Signer;
	/** The lifetime a mint may ask for, in ms: clamped to `[min, max]` (`min` defaults to 1). */
	ttl: { max: number; min?: number };
	/** One check per nonce, remembering at most `max` live nonces at a time. Off by default: a
	 *  token that is meant to be presented many times (a cached page's region URL) leaves it off. */
	replay?: { max: number };
	/** `false`: no random nonce, so the same audience, fields and expiry always mint the same token
	 *  (a page's links stay byte-identical between renders). Such tokens are NOT single-use: they
	 *  check as often as presented, and `replay` is refused with them. Default `true`. */
	nonce?: boolean;
	/** How far the minter's clock and the checker's may differ, in ms (default 0): a token checks
	 *  until `skew` past its expiry, and may claim up to `ttl.max + skew` ahead. For a token minted
	 *  on one machine and checked on another. */
	skew?: number;
	/** The clock, in ms (default `Date.now`). */
	now?: () => number;
}

/** Why a token was refused. A wrong audience, name, field or key is `sig`: the message differs. */
export type CapabilityRefusal =
	| 'shape'
	| 'version'
	| 'expired'
	| 'lifetime'
	| 'sig'
	| 'replayed'
	| 'full';

/** What a check says. */
export type CapabilityCheck =
	| { ok: true; exp: number; nonce: string }
	| { ok: false; why: CapabilityRefusal };

/** A capability: see {@link capability}. */
export interface Capability {
	/** A token for `audience` and `fields`, valid for `ttl` ms (clamped). */
	mint(audience: string, fields: readonly string[], ttl: number): string;
	/** Is `token` one this capability minted for `audience` and exactly these `fields`, still live
	 *  (and, with `replay`, not checked before)? `verify`, when given, replaces the signer's for this
	 *  check (the keys this call trusts: several in a rotation, or the caller's own). */
	check(
		token: string,
		audience: string,
		fields: readonly string[],
		verify?: Signer['verify']
	): CapabilityCheck;
	/** The exact message a token's signature covers (for a signer's own tests and benches). */
	message(audience: string, exp: number, nonce: string, fields: readonly string[]): string;
}

/** `v<version>.<expiry ms>.<nonce>.<signature>`: every part URL-safe, none holds a `.`. With
 *  nonce off, the nonce part is empty (`v3.<exp>..<sig>`), so the two kinds never pass for each other. */
const TOKEN_RE = /^v(\d{1,6})\.(\d{1,16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16,512})$/;
const FIXED_RE = /^v(\d{1,6})\.(\d{1,16})\.()\.([A-Za-z0-9_-]{16,512})$/;
const SIG_RE = /^[A-Za-z0-9_-]{16,512}$/;

/** A field, length-prefixed (its length in UTF-16 units, the same on both sides of a check). */
const lp = (s: string): string => `${s.length}:${s}`;

function bad(option: string, value: unknown, rule: string): never {
	throw machine_error('machine_bad_option', { option, value: String(value), rule });
}

/** 16 random bytes as base64url (22 characters). */
function nonce(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);
}

/**
 * A signed, expiring, addressed token kind: see the module comment.
 */
export function capability(options: CapabilityOptions): Capability {
	const { name, version, signer } = options;
	if (typeof name !== 'string' || name === '') bad('name', name, 'a non-empty string');
	if (!Number.isInteger(version) || version < 1 || version > 999_999)
		bad('version', version, 'a whole number from 1');
	const max = options.ttl.max;
	const min = options.ttl.min ?? 1;
	if (!Number.isFinite(max) || max < 1) bad('ttl.max', max, 'a finite number of ms, 1 or more');
	if (!Number.isFinite(min) || min < 1 || min > max)
		bad('ttl.min', min, 'a finite number of ms, from 1 to ttl.max');
	const replay_max = options.replay?.max;
	if (replay_max !== undefined && (!Number.isInteger(replay_max) || replay_max < 1))
		bad('replay.max', replay_max, 'a whole number of nonces, 1 or more');
	const random = options.nonce ?? true;
	if (!random && replay_max !== undefined)
		bad('replay', 'on', 'off when nonce is false: a nonce-less token is not single-use');
	const token_re = random ? TOKEN_RE : FIXED_RE;
	const skew = options.skew ?? 0;
	if (!Number.isFinite(skew) || skew < 0) bad('skew', skew, 'a finite number of ms, 0 or more');
	const now = options.now ?? Date.now;
	const head = `${lp(name)}|${lp(String(version))}|`;
	/** nonce → its token's expiry, while it could still be presented */
	const seen = new Map<string, number>();

	const message = (audience: string, exp: number, n: string, fields: readonly string[]) => {
		let m = `${head}${lp(audience)}|${lp(String(exp))}|${lp(n)}|${fields.length}`;
		for (const f of fields) m = `${m}|${lp(f)}`;
		return m;
	};
	const clock = (where: string): number => {
		const t = now();
		if (!Number.isFinite(t)) throw machine_error('machine_bad_time', { where, ms: String(t) });
		return t;
	};
	const audience_ok = (audience: string) => {
		if (typeof audience !== 'string' || audience === '')
			bad('audience', audience, 'a non-empty string: who may present the token');
	};

	return {
		message,
		mint(audience, fields, ttl) {
			audience_ok(audience);
			if (!Number.isFinite(ttl)) bad('ttl', ttl, 'a finite number of ms');
			const exp = Math.floor(
				clock(`capability "${name}" mint`) + Math.min(max, Math.max(min, ttl))
			);
			const n = random ? nonce() : '';
			const sig = signer.sign(message(audience, exp, n, fields));
			if (!SIG_RE.test(sig))
				bad('signer.sign', sig.slice(0, 16), 'a URL-safe signature (hex or base64url)');
			return `v${version}.${exp}.${n}.${sig}`;
		},
		check(token, audience, fields, verify) {
			audience_ok(audience);
			const m = typeof token === 'string' ? token_re.exec(token) : null;
			if (!m) return { ok: false, why: 'shape' };
			if (Number(m[1]) !== version) return { ok: false, why: 'version' };
			const exp = Number(m[2]);
			const t = clock(`capability "${name}" check`);
			// (the last moment it checks: its expiry, plus the clocks' difference)
			const end = exp + skew;
			if (end <= t) return { ok: false, why: 'expired' };
			if (exp > t + max + skew) return { ok: false, why: 'lifetime' };
			const n = m[3]!;
			const msg = message(audience, exp, n, fields);
			if (!(verify ? verify(msg, m[4]!) : signer.verify(msg, m[4]!)))
				return { ok: false, why: 'sig' };
			if (replay_max !== undefined) {
				if (seen.has(n)) return { ok: false, why: 'replayed' };
				if (seen.size >= replay_max) for (const [k, e] of seen) if (e <= t) seen.delete(k);
				// (full of live nonces: forgetting one would let it check twice, so the new one waits)
				if (seen.size >= replay_max) return { ok: false, why: 'full' };
				seen.set(n, end);
			}
			return { ok: true, exp, nonce: n };
		}
	};
}
