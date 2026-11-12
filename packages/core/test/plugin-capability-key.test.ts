// A PLUGIN CAPABILITY NAMES ITS KEY (#1007, found by the simulator). A plugin's capability (a
// deferred peer region's address) carries the key fingerprint a region capability does (`&k=`), so
// a deployment that signs with another key (a rolling deploy with no shared OGYGIA_SECRET) refuses
// it as `foreign-key`, with the advice that goes with it, not as a bad signature.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	plugin_capabilities,
	plugin_signer,
	type CapabilitySigner
} from '../src/plugin/capability.ts';
import { capability_lifetime } from '../src/server/capability-lifetime.ts';
import { RENEW_WINDOW_SEC } from '../src/server/shared-cache.ts';

/** A deployment's signer under `key`, its fingerprint `fp`. */
function signer(key: string, fp: string): CapabilitySigner {
	const mac = (message: string) => createHmac('sha256', key).update(message).digest('base64url');
	return {
		sign: mac,
		verify(message, signature) {
			const want = Buffer.from(mac(message));
			const got = Buffer.from(signature);
			return want.length === got.length && timingSafeEqual(want, got);
		},
		fingerprint: () => fp,
		lifetime: capability_lifetime({
			building: false,
			region_ttl: 3600,
			renew_window: RENEW_WINDOW_SEC,
			request: () => null
		}),
		deny: (why) => new Response('Forbidden', { status: 403, headers: { 'x-ogygia-deny': why } })
	};
}

const message = (exp: string) => `frag/2:${JSON.stringify(['peer', 'widget', 'kpis', '', exp])}`;

/** The address a plugin builds from what `mint` hands back (federation's hole: every field a param). */
const address = (minted: Record<string, string>) =>
	new URL(`http://app.test/og/frag?peer=peer&${new URLSearchParams(minted)}`);

describe('a plugin capability', () => {
	const v1 = plugin_capabilities(
		plugin_signer('@ogygia/federation', signer('key-of-v1', 'aaaaaaaa'))
	);
	const v2 = plugin_capabilities(
		plugin_signer('@ogygia/federation', signer('key-of-v2', 'bbbbbbbb'))
	);

	it('opens on the deployment that minted it', () => {
		expect(v1.open(address(v1.mint(message)), message).ok).toBe(true);
	});

	it('minted by another deployment is refused as foreign-key, not as a bad signature', () => {
		const opened = v1.open(address(v2.mint(message)), message);
		expect(opened.ok).toBe(false);
		expect(!opened.ok && opened.response.headers.get('x-ogygia-deny')).toBe('foreign-key');
	});

	it('with its key named but its signature changed is still a bad signature', () => {
		const minted = v1.mint(message);
		const forged = address({ ...minted, sig: minted.sig.slice(1) + 'A' });
		const opened = v1.open(forged, message);
		expect(!opened.ok && opened.response.headers.get('x-ogygia-deny')).toBe('sig');
	});
});
