// A PROFILER WINDOW ID: a capability (@ogygia/machine) any instance of the app can check, so the
// requests a window's actions make are written to the shared store under it. Signed under a key
// derived from the profiler's secret for window ids alone; dev with no secret signs under a random
// key of its own process. Loaded on first use (it reads node:crypto). Tested in
// test/profiler-window-id.test.ts.
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { capability, type Signer } from '@ogygia/machine';

/** How long a window id checks: a window's cap (a minute) and a stop that comes late. */
export const WINDOW_ID_MS: number = 10 * 60_000;

/** The longest header value a check reads. */
const MAX_ID = 160;

/** Mints and checks window ids. */
export interface WindowIds {
	mint(): string;
	/** The id when it checks, else null. */
	check(raw: string | null): string | null;
}

/** HMAC-SHA256 under `key`, as base64url; verified in constant time. */
function hmac_signer(key: Buffer): Signer {
	const sign = (message: string) => createHmac('sha256', key).update(message).digest('base64url');
	return {
		sign,
		verify(message, sig) {
			const want = Buffer.from(sign(message));
			const got = Buffer.from(sig);
			return got.length === want.length && timingSafeEqual(got, want);
		}
	};
}

/** Window ids for a profiler: null for a production one with no secret (it takes none). */
export function window_ids(secret: string, dev: boolean, audience = 'profiler'): WindowIds | null {
	if (!secret && !dev) return null;
	const key = secret
		? Buffer.from(hkdfSync('sha256', secret, '', 'ogygia-profiler-window-v1', 32))
		: randomBytes(32);
	const cap = capability({
		name: 'profiler.window',
		version: 1,
		signer: hmac_signer(key),
		ttl: { max: WINDOW_ID_MS }
	});
	return {
		mint: () => cap.mint(audience, [], WINDOW_ID_MS),
		check(raw) {
			if (!raw || raw.length > MAX_ID) return null;
			return cap.check(raw, audience, []).ok ? raw : null;
		}
	};
}
