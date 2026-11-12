/**
 * HMAC-SHA256 for region capability URLs — Node `createHmac` (sync).
 *
 * Used by `ogygiaHandle` and by SSR `ogygia:server/sign`. The client never imports this
 * module: ServerIsland goes through `ogygia:server/sign`, which is a no-op on the client
 * (secret is already empty there). Web Crypto is not used — browsers must not mint with a
 * real secret.
 *
 * Every capability is minted as v3: capability() from @ogygia/machine (its message names the
 * capability, its version and its audience, field by field length-prefixed). The `v1|`/`v2|` MACs
 * are still verified for URLs minted before it. Signing keys are HKDF-derived (`ogygia-mac-v1`)
 * from the raw secret so the id-salt domain stays separate.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { cache, capability, type Capability } from '@ogygia/machine';
import { PRERENDER_REGION_TTL_SEC, REGION_CAPABILITY_VERSION, is_lower_hex } from './endpoint.ts';
const MAC_INFO = Buffer.from('ogygia-mac-v1');
const ID_SALT_INFO = Buffer.from('ogygia-id-salt-v1');
const utf8 = new TextEncoder();

/** Minimum UTF-8 byte length for a user-supplied `OGYGIA_SECRET` in production builds. */
export const MIN_SECRET_BYTES = 16;

// The secret is a process constant (env / build), so the derived key is too: derived once per
// distinct secret, not once per sign and once per verify (an HKDF per island mint and per hole
// request added up on a page of twenty). Bounded: a process sees one secret, tests a handful.
const mac_keys = cache<string, Buffer>({ name: 'mac keys', max: 16 });

/** HKDF-SHA256 → 32-byte MAC key (hex for stable logging / tests; Buffer used internally). */
export function derive_mac_key(secret: string): Buffer {
	let key = mac_keys.get(secret);
	if (key === undefined) {
		key = Buffer.from(
			hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), MAC_INFO, 32)
		);
		mac_keys.set(secret, key);
	}
	return key;
}

/** HKDF-SHA256 → 16-byte id salt (hex). Empty input must not be used — caller gates on env. */
export function derive_id_salt(secret: string): string {
	return Buffer.from(
		hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), ID_SALT_INFO, 16)
	).toString('hex');
}

/** True when a configured secret meets the production entropy floor. */
export function secret_has_min_entropy(secret: string): boolean {
	return Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_BYTES;
}

/** UTF-8 length-prefix so field contents cannot forge delimiters. */
function lp(s: string): string {
	return `${utf8.encode(s).byteLength}:${s}`;
}

export class Hmac {
	static sha256(key: Buffer, message: string): string {
		return createHmac('sha256', key).update(message, 'utf8').digest('hex');
	}

	static sign(secret: string, message: string): string {
		return Hmac.sha256(derive_mac_key(secret), message);
	}

	static verify(secret: string, message: string, sig: string): boolean {
		// Reject non-hex / wrong length before Buffer work (L-HMAC charset precheck).
		if (typeof sig !== 'string' || !is_lower_hex(sig, 64)) return false;
		const expected = Hmac.sha256(derive_mac_key(secret), message);
		try {
			return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
		} catch {
			return false;
		}
	}

	/**
	 * MAC message for a signed region capability. Every field is length-prefixed (`<utf8 bytes>:<value>`),
	 * so a field's content can never forge a `|` boundary. Two versions:
	 *
	 * - `v1|id|exp|props|session|ttl` — the capability names only its region `id` (the wrapper that
	 *   minted it: component ⊕ page-side schedule ⊕ the build's salt). Only a build that has that
	 *   exact id can answer it. Minted before render identities (ogygia ≤ 0.8.6); still verified, so
	 *   pages cached before an upgrade keep their holes.
	 * - `v2|id|exp|props|session|ttl|render` — the same five, plus the region's render identity (the
	 *   URL's `r`: the component the endpoint renders, compiler/region/identity.ts `renderId`). Signing
	 *   it lets a build that no longer has `id` (another schedule, preset or salt) answer the
	 *   capability with its own entry for that component, and only for that component. Minted until
	 *   v3 ({@link region_sign}); still verified.
	 *
	 * The version follows from the URL: a capability with `r` is checked as `v2`, one without as `v1`.
	 * A `v2` MAC never verifies as `v1` (the prefix and the field count differ), so stripping `r` or
	 * swapping it for another component breaks the signature. Empty `session`/`ttl` are still fields
	 * (prerender / unbound / no-store) — never optional concat. `ttl` is the response cache max-age in
	 * seconds (`''` = no-store); signing it keeps a harvested URL from being re-pointed at a longer
	 * browser cache.
	 */
	static region_message(
		id: string,
		exp: number | string,
		props: string,
		session = '',
		ttl: number | string = '',
		render = ''
	): string {
		const v1 = `${lp(String(id))}|${lp(String(exp))}|${lp(String(props))}|${lp(String(session))}|${lp(String(ttl))}`;
		return render === '' ? `v1|${v1}` : `v2|${v1}|${lp(String(render))}`;
	}
}

export const sign: typeof Hmac.sign = Hmac.sign.bind(Hmac);
export const verify: typeof Hmac.verify = Hmac.verify.bind(Hmac);
export const region_mac_message: typeof Hmac.region_message = Hmac.region_message.bind(Hmac);

/** What a region capability signs beside its expiry (the URL's `id`, `props`, `ttl`, `r`, and the
 *  session cookie it is sealed to; `''` where it has none). */
export interface RegionClaim {
	id: string;
	payload: string;
	session: string;
	ttl: string;
	render: string;
}

// A capability per secret and lateness (a renewal checks an expired one): both process constants.
const region_caps = cache<string, Capability>({ name: 'region capabilities', max: 16 });

/**
 * The region capability (v3): capability() with no nonce, so every render of a hole in one expiry
 * window signs the same URL (its expiry is the window's: server/endpoint.ts `capability_expiry`).
 * Not single-use, like v1/v2. `late_sec`: how long past its expiry it still checks (a renewal).
 * Lifetimes past the longest the app mints (prerender-grade) are refused.
 */
function region_capability(secret: string, late_sec: number): Capability {
	const at = `${late_sec}|${secret}`;
	let cap = region_caps.get(at);
	if (cap === undefined) {
		const key = derive_mac_key(secret);
		cap = capability({
			name: 'region',
			version: Number(REGION_CAPABILITY_VERSION),
			nonce: false,
			ttl: { max: PRERENDER_REGION_TTL_SEC * 1000 },
			// (a second's slack: the renew window is checked in whole seconds before this)
			skew: late_sec > 0 ? (late_sec + 1) * 1000 : 0,
			signer: {
				sign: (m) => Hmac.sha256(key, m),
				verify: (m, sig) => is_lower_hex(sig, 64) && hex_equal(Hmac.sha256(key, m), sig)
			}
		});
		region_caps.set(at, cap);
	}
	return cap;
}

const claim_fields = (c: RegionClaim) => [c.id, c.payload, c.session, c.ttl, c.render];

/** Two lowercase-hex strings of one length, compared in constant time. */
function hex_equal(a: string, b: string): boolean {
	return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** The v3 signature of a region capability for `audience` (the islands endpoint), expiring at
 *  `exp` (unix seconds). The URL carries `exp`, `v=3` and this; the token is rebuilt to check. */
export function region_sign(
	secret: string,
	audience: string,
	exp: number,
	claim: RegionClaim
): string {
	const token = region_capability(secret, 0).mintUntil(audience, claim_fields(claim), exp * 1000);
	return token.slice(token.lastIndexOf('.') + 1);
}

/**
 * Does `sig` sign this region capability? `version` is the URL's `v`: `'3'` checks it through
 * capability() for `audience`; `''` (minted before v3) checks the `v1|`/`v2|` MAC, so pages cached
 * before an upgrade keep their holes; anything else is refused. A v3 signature never verifies as
 * v1/v2, nor the other way (the messages differ). `late_sec`: a renewal's window past expiry.
 */
export function region_verify(
	secret: string,
	audience: string,
	version: string,
	exp: string,
	claim: RegionClaim,
	sig: string,
	late_sec = 0
): boolean {
	if (version === '')
		return verify(
			secret,
			region_mac_message(claim.id, exp, claim.payload, claim.session, claim.ttl, claim.render),
			sig
		);
	const at = Number(exp);
	if (version !== REGION_CAPABILITY_VERSION || !Number.isSafeInteger(at) || at < 0) return false;
	const token = `v${version}.${at * 1000}..${sig}`;
	return region_capability(secret, late_sec).check(token, audience, claim_fields(claim)).ok;
}
