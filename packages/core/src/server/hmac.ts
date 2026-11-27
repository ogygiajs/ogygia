/**
 * HMAC-SHA256 for region capability URLs — Node `createHmac` (sync).
 *
 * Used by `ogygiaHandle` and by SSR `ogygia:server/sign`. The client never imports this
 * module: ServerIsland goes through `ogygia:server/sign`, which is a no-op on the client
 * (secret is already empty there). Web Crypto is not used — browsers must not mint with a
 * real secret.
 *
 * Every capability is minted as v3: capability() from @ogygia/machine (its message names the
 * capability, its version and its audience, field by field length-prefixed), and only v3 is
 * verified (#1769). Signing keys are HKDF-derived (`ogygia-mac-v1`) from the raw secret so the
 * id-salt domain stays separate.
 */
import {
	createHmac,
	createSecretKey,
	hkdfSync,
	timingSafeEqual,
	type KeyObject
} from 'node:crypto';
import { cache, capability, type Capability } from '@ogygia/machine';
import { OgygiaError } from '../messages/server.ts';
import { PRERENDER_REGION_TTL_SEC, REGION_CAPABILITY_VERSION, is_lower_hex } from './endpoint.ts';
const MAC_INFO = Buffer.from('ogygia-mac-v1');
const ID_SALT_INFO = Buffer.from('ogygia-id-salt-v1');
const BUILD_KEY_INFO = Buffer.from('ogygia-build-key-v1');

/** Minimum UTF-8 byte length for a user-supplied `OGYGIA_SECRET` in production builds. */
export const MIN_SECRET_BYTES = 16;

// The secret is a process constant (env / build), so the derived key is too: derived once per
// distinct secret, not once per sign and once per verify (an HKDF per island mint and per hole
// request added up on a page of twenty). Bounded: a process sees one secret, tests a handful.
const mac_keys = cache<string, KeyObject>({ name: 'mac keys', max: 16 });

/** HKDF-SHA256 → the 32-byte MAC key, as the KeyObject every HMAC of it takes: made once per
 *  secret (an HMAC keyed by bytes makes Node build a key object again for each one). */
export function derive_mac_key(secret: string): KeyObject {
	let key = mac_keys.get(secret);
	if (key === undefined) {
		key = createSecretKey(
			Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), MAC_INFO, 32))
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

/** HKDF-SHA256 → the 32-byte build key (hex) a build with the app's secret bakes into its server
 *  bundle: a function of the secret alone, so two builds of one source and secret write the same
 *  bundle, and the bundle holds no secret it was derived from. A blank secret is refused
 *  (`build_key_blank_secret`): a key made from it is the same for every app. */
export function derive_build_key(secret: string): string {
	if (secret.trim() === '') throw new OgygiaError('build_key_blank_secret');
	return Buffer.from(
		hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), BUILD_KEY_INFO, 32)
	).toString('hex');
}

/** True when a configured secret meets the production entropy floor. */
export function secret_has_min_entropy(secret: string): boolean {
	return Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_BYTES;
}

export class Hmac {
	static sha256(key: KeyObject, message: string): string {
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
			// oxlint-disable-next-line ogygia/no-silent-failures -- buffers that cannot be compared are not a match (fail closed)
		} catch {
			return false;
		}
	}
}

export const sign: typeof Hmac.sign = Hmac.sign.bind(Hmac);
export const verify: typeof Hmac.verify = Hmac.verify.bind(Hmac);

/** What a region capability signs beside its expiry (the URL's `id`, `props`, `ttl`, `r`, `w`, and
 *  the session cookie it is sealed to; `''` where it has none). */
export interface RegionClaim {
	id: string;
	payload: string;
	session: string;
	ttl: string;
	render: string;
	/** `'1'`: the hole's component hydrates over the answer (#906); `''` when it does not */
	wakes: string;
}

// A capability per secret and lateness (a renewal checks an expired one): both process constants.
const region_caps = cache<string, Capability>({ name: 'region capabilities', max: 16 });

/**
 * The region capability (v3): capability() with no nonce, so every render of a hole in one expiry
 * window signs the same URL (its expiry is the window's: server/endpoint.ts `capability_expiry`).
 * Not single-use, like v1/v2. `late_sec`: how long past its expiry it still checks (a renewal).
 * Lifetimes past the longest the app mints (prerender-grade) are refused.
 */
export function region_capability(secret: string, late_sec: number): Capability {
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

/** The claim's fields in the order the capability signs them. */
export const claim_fields = (c: RegionClaim): string[] => [
	c.id,
	c.payload,
	c.session,
	c.ttl,
	c.render,
	c.wakes
];

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
