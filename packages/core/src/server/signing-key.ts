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
import { build_key, build_had_secret, sign } from 'ogygia:server';
import { building } from '$app/env';
import { OgygiaError, warn } from '../messages/server.ts';

export interface SigningKey {
	secret: string;
	/** the app's or the env's: survives redeploys and is shared by every deployment that sets the same value */
	stable: boolean;
	/** 8-char key fingerprint (`&k=` on capabilities, `x-ogygia-key` on refusals) */
	fp: string;
	/** where the secret came from: `handle({ secret })`, `OGYGIA_SECRET`, or this build's random key */
	source: 'option' | 'env' | 'build';
}

/**
 * The process's key, one state at a time:
 *
 *   undecided ─ secret ─ decided
 *             ╲────────╱
 *
 * `undecided`: no secret from the app yet, and nobody minted or verified. `secret`: the app's
 * `handle({ secret })` is recorded, not used yet. `decided`: the first mint or verify picked the
 * key, and it never changes in the process.
 */
type KeySlot =
	| { kind: 'undecided' }
	| { kind: 'secret'; option: string }
	| { kind: 'decided'; key: SigningKey };

const SLOT = Symbol.for('ogygia.signing-key');

const SOURCE_NAME: Record<SigningKey['source'], string> = {
	option: 'handle({ secret })',
	env: 'OGYGIA_SECRET',
	build: "this build's random key"
};

const slots = globalThis as unknown as Record<symbol, KeySlot | undefined>;

function slot(): KeySlot {
	return slots[SLOT] ?? { kind: 'undecided' };
}

export function signing_key(): SigningKey {
	const s = slot();
	if (s.kind === 'decided') return s.key;
	const from_env = (typeof process !== 'undefined' && process.env?.OGYGIA_SECRET) || '';
	let secret = build_key;
	let source: 'option' | 'env' | 'build' = 'build';
	if (s.kind === 'secret') {
		secret = s.option;
		source = 'option';
	} else if (from_env) {
		secret = from_env;
		source = 'env';
	}
	const key: SigningKey = {
		secret,
		stable: source !== 'build',
		fp: key_fingerprint(secret),
		source
	};
	slots[SLOT] = { kind: 'decided', key };
	if (!key.stable && !import.meta.env.DEV) warn_build_key();
	return key;
}

/**
 * Record the app's `handle({ secret })`. A blank one counts as none (an app can pass a value that may
 * be unset). Once a key is decided it never changes in the process: capabilities minted under the
 * first would stop verifying, so a different secret arriving later is an error (thrown in dev).
 */
export function configure_signing_secret(secret: string | undefined): void {
	if (!secret?.trim()) return;
	const s = slot();
	if (s.kind === 'undecided') {
		slots[SLOT] = { kind: 'secret', option: secret };
		return;
	}
	const decided = s.kind === 'decided' ? s.key.secret : s.option;
	if (decided === secret) return;
	const from =
		s.kind === 'decided'
			? `${SOURCE_NAME[s.key.source]}, decided by an earlier mint or verify`
			: 'another handle({ secret })';
	const error = new OgygiaError('secret_conflict', {
		key: key_fingerprint(secret),
		decided: key_fingerprint(decided),
		from
	});
	if (import.meta.env.DEV) throw error;
	console.error(error);
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
	if (building) warn('build_key_prerender');
	else if (build_had_secret) console.error(new OgygiaError('secret_missing_at_runtime'));
	else warn('secret_missing');
}

/** Tests: forget the decided key and the app's secret. */
export function reset_signing_key(): void {
	delete slots[SLOT];
}
