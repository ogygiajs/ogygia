/**
 * A plugin's signatures are its own (#751, #752): what `app.sign` and `app.capability` sign is
 * domain-separated by the plugin's name, under the app's region key. Nothing a plugin signs verifies
 * as a region capability, and two plugins whose names differ (dotted ones too) never share a valid
 * signature or capability.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { defineServer, type ServerApp } from '../src/plugin/index.ts';
import { start_plugins, type AppSigner } from '../src/plugin/server.ts';
import { capability_lifetime } from '../src/server/capability-lifetime.ts';
import { RENEW_WINDOW_SEC } from '../src/server/shared-cache.ts';
import { region_sign, sign, verify, type RegionClaim } from '../src/server/hmac.ts';

const SECRET = 'plugin-signing-test-secret-0123456789';
const AUD = '/__ogygia__';

/** The handle's signer: the app's region key, as hooks.ts hands it to the plugins. */
const APP_SIGNER: AppSigner = {
	sign: (message) => sign(SECRET, message),
	verify: (message, signature) => verify(SECRET, message, signature),
	fingerprint: () => 'aaaaaaaa',
	lifetime: capability_lifetime({
		building: false,
		region_ttl: 3600,
		renew_window: RENEW_WINDOW_SEC,
		request: () => null
	}),
	deny: (why) => new Response('Forbidden', { status: 403, headers: { 'x-ogygia-deny': why } }),
	charge: () => null
};
/** A request for `url`, as `capability.open` takes it. */
const at = (url: URL) => ({ url, request: new Request(url) }) as never;

let leaves: Array<() => void> = [];
afterEach(() => {
	for (const leave of leaves) leave();
	leaves = [];
});

/** The live apps of plugins named `names`, started as the handle starts them. */
function apps(...names: string[]): ServerApp<unknown>[] {
	const started = start_plugins(
		names.map((name) => ({ name, options: undefined, server: defineServer({}) })),
		APP_SIGNER
	);
	leaves.push(started.leave);
	return started.plugins.map((p) => p.app);
}

const claim: RegionClaim = {
	id: 'abcdef012345',
	payload: 'eyJuIjoxfQ',
	session: '',
	ttl: '',
	render: 'c0ffee0c0ffe',
	wakes: ''
};

describe("a plugin's signature never verifies as a region capability", () => {
	it('no message a plugin signs gives the signature the app key gives that message', () => {
		const [app] = apps('flags');
		fc.assert(fc.property(fc.string(), (message) => app!.sign(message) !== sign(SECRET, message)));
	});

	it('a v3 region signature does not verify as a plugin signature of any field', () => {
		const [app] = apps('flags');
		const exp = Math.floor(Date.now() / 1000) + 600;
		const sig = region_sign(SECRET, AUD, exp, claim);
		for (const message of [claim.id, claim.payload, claim.render, String(exp), AUD])
			expect(app!.verify(message, sig)).toBe(false);
	});
});

describe('two plugins whose names differ never share a valid signature', () => {
	it('plugin `a` signing `b.x` is not plugin `a.b` signing `x`', () => {
		const [a, ab] = apps('a', 'a.b');
		expect(ab!.verify('x', a!.sign('b.x'))).toBe(false);
		expect(a!.verify('b.x', ab!.sign('x'))).toBe(false);
	});

	it('any two names and messages: a signature checks only for its own plugin and message', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1 }),
				fc.string({ minLength: 1 }),
				fc.string(),
				fc.string(),
				(n1, n2, m1, m2) => {
					fc.pre(n1 !== n2);
					const [p1, p2] = apps(n1, n2);
					const sig = p1!.sign(m1);
					return p1!.verify(m1, sig) && !p2!.verify(m2, sig);
				}
			),
			{ numRuns: 200 }
		);
	});

	it("plugin `a`'s capability for `b.x` is refused by plugin `a.b` for `x`", () => {
		const [a, ab] = apps('a', 'a.b');
		const { exp, sig } = a!.capability.mint((e) => `b.x|${e}`);
		const url = new URL(`http://app.example.com/peer?exp=${exp}&sig=${sig}`);
		expect(a!.capability.open(at(url), (e) => `b.x|${e}`).ok).toBe(true);
		const opened = ab!.capability.open(at(url), (e) => `x|${e}`);
		expect(opened.ok).toBe(false);
		if (!opened.ok) expect(opened.response.headers.get('x-ogygia-deny')).toBe('sig');
	});

	it("a plugin's capability is not its plain signature of the same message", () => {
		const [app] = apps('flags');
		const { exp, sig } = app!.capability.mint((e) => `m|${e}`);
		expect(app!.verify(`m|${exp}`, sig)).toBe(false);
	});
});
