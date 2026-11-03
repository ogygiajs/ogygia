/**
 * THE region signing key, decided once at first use (the first mint or verify), not at module eval:
 * a host that fills `process.env` after the server's modules load (an adapter loading a `.env` late)
 * still counts. The app's `handle({ secret })` wins, then the runtime's `OGYGIA_SECRET`, else this
 * build's random key.
 *
 * Process-wide on `globalThis`, not module state (like the islands endpoint, server/endpoint.ts):
 * one server can load this file as two copies (pnpm gives a package one folder per set of peer
 * versions), and a copy that never saw the handle's secret would mint with the build's key.
 *
 * A capability carries its minter's key FINGERPRINT (`&k=`): an HMAC of a constant under the key —
 * the same on every instance sharing the key, and it reveals nothing of the key. A deployment that
 * verifies a capability minted under another key can then say so (`x-ogygia-deny: foreign-key`)
 * instead of an opaque 403: the page and its islands endpoint came from different deployments (a CDN
 * routing them to two backends, HTML cached across a key change).
 */
import { buildKey, buildHadSecret } from 'virtual:ogygia/secret';
import { sign } from 'virtual:ogygia/sign';
import { building } from '$app/environment';

export interface SigningKey {
	secret: string;
	/** the app's or the env's: survives redeploys and is shared by every deployment that sets the same value */
	stable: boolean;
	/** 8-char key fingerprint (`&k=` on capabilities, `x-ogygia-key` on refusals) */
	fp: string;
	/** where the secret came from: `handle({ secret })`, `OGYGIA_SECRET`, or this build's random key */
	source: 'option' | 'env' | 'build';
}

interface KeySlot {
	/** `handle({ secret })`, recorded as the hooks load */
	option?: string;
	/** the decided key */
	key?: SigningKey;
}

const SLOT = Symbol.for('ogygia.signing-key');

const SOURCE_NAME: Record<SigningKey['source'], string> = {
	option: 'handle({ secret })',
	env: 'OGYGIA_SECRET',
	build: "this build's random key"
};

function slot(): KeySlot {
	const g = globalThis as unknown as Record<symbol, KeySlot | undefined>;
	return (g[SLOT] ??= {});
}

export function signing_key(): SigningKey {
	const s = slot();
	if (s.key) return s.key;
	const from_env = (typeof process !== 'undefined' && process.env?.OGYGIA_SECRET) || '';
	const [secret, source] = s.option
		? [s.option, 'option' as const]
		: from_env
			? [from_env, 'env' as const]
			: [buildKey, 'build' as const];
	s.key = { secret, stable: source !== 'build', fp: key_fingerprint(secret), source };
	if (!s.key.stable && !import.meta.env.DEV) warn_build_key();
	return s.key;
}

/**
 * Record the app's `handle({ secret })`. A blank one counts as none (an app can pass a value that may
 * be unset). Once a key is decided it never changes in the process: capabilities minted under the
 * first would stop verifying, so a different secret arriving later is an error (thrown in dev).
 */
export function configure_signing_secret(secret: string | undefined): void {
	if (!secret?.trim()) return;
	const s = slot();
	const decided = s.key?.secret ?? s.option;
	if (decided === undefined || decided === secret) {
		s.option = secret;
		return;
	}
	const from = s.key
		? `${SOURCE_NAME[s.key.source]}, decided by an earlier mint or verify`
		: 'another handle({ secret })';
	const message = `[ogygia] handle({ secret }) names key ${key_fingerprint(secret)}, but this server already signs with key ${key_fingerprint(decided)} (from ${from}). The first key stays: pass one secret, before anything renders.`;
	if (import.meta.env.DEV) throw new Error(message);
	console.error(message);
}

export function key_fingerprint(secret: string): string {
	return sign(secret, 'ogygia:key-fp').slice(0, 8);
}

/** One message per process (a shared Symbol: one across every copy of this module): a server
 *  signing with this build's random key. */
function warn_build_key(): void {
	const g = globalThis as Record<symbol, unknown>;
	const K = Symbol.for('ogygia.build-key-warned');
	if (g[K]) return;
	g[K] = true;
	if (building) {
		console.warn(
			'[ogygia] prerendered page mints region capabilities signed with a per-build random key — they stop verifying after your next deploy while the static HTML lives on. Set a stable OGYGIA_SECRET env var (or pass it to handle({ secret })) so prerendered holes survive redeploys.'
		);
	} else if (buildHadSecret) {
		console.error(
			"[ogygia] OGYGIA_SECRET was set when this app was built but is not set where it runs: region capabilities are signed with this build's random key, so every hole minted by another deployment (another backend behind the same CDN, the previous deploy) is refused (403, x-ogygia-deny: foreign-key). Set OGYGIA_SECRET in the server's runtime environment, or pass it to handle({ secret }) (e.g. from $env/static/private)."
		);
	} else {
		console.warn(
			"[ogygia] OGYGIA_SECRET is not set: region capabilities are signed with this build's random key, so a page cached across a deploy, or served by another deployment than its islands endpoint, gets its holes refused (403, x-ogygia-deny: foreign-key). Set a stable OGYGIA_SECRET, or pass one to handle({ secret })."
		);
	}
}

/** Tests: forget the decided key and the app's secret. */
export function reset_signing_key(): void {
	delete (globalThis as unknown as Record<symbol, KeySlot | undefined>)[SLOT];
}
