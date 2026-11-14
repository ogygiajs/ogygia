/**
 * A plugin's own signed capabilities (`app.capability`): the URL of an endpoint the plugin serves
 * (federation's remote-region hole), held to the app's rules for region holes. The same lifetime
 * (server/capability-lifetime.ts), expiry in unix seconds, and the same answer once one expired: a
 * 403 `x-ogygia-deny: expired`, which the runtime retries once with `&renew=1`, re-signed here and
 * handed back in `x-ogygia-capability`. Messages are signed in the plugin's own domain
 * ({@link plugin_signer}), so a capability never crosses plugins and never passes for a region
 * MAC. Used by plugin/server.ts only.
 *
 * Opening one is a region request (PROBE-THEN-RENDER, server/region-request.ts): the visitor's probe
 * budget before any HMAC, the signature, then the render budget, the handle's own budgets
 * (test/plugin-hole-budgets.test.ts). A plugin's plain `sign` / `verify` refuse a capability
 * message, so `open` is the one way in.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { clock } from '@ogygia/machine';
import type { CapabilityOpened, PluginCapabilities } from './index.ts';
import { expiry_refusal } from '../server/shared-cache.ts';
import type { CapabilityLifetime } from '../server/capability-lifetime.ts';
import { region_request } from '../server/region-request.ts';
import { OgygiaError } from '../messages/server.ts';

/** Why a plugin capability is refused (the region endpoint's reasons of the same name).
 *  `foreign-key`: it names another signing key than this deployment's (#1007). */
export type CapabilityDeny = 'expired' | 'renew-window' | 'foreign-key' | 'sig';

/** What the handle hands in: the app's key, its hole lifetime, and the refusal a region request
 *  gets. (Handed in, never imported: this module stays free of the app's virtual modules, so the
 *  plugin test harness runs it as it is.) */
export interface CapabilitySigner {
	sign: (message: string) => string;
	verify: (message: string, signature: string) => boolean;
	/** The key's fingerprint, as a region capability carries it (`&k=`, server/signing-key.ts). */
	fingerprint(): string;
	lifetime: CapabilityLifetime;
	deny(why: CapabilityDeny): Response;
	/** The request's region budget for one step: `probe` before any HMAC, `render` once the
	 *  signature checks. The over-budget answer (a 429 with Retry-After), or null to go on. */
	charge(event: RequestEvent, step: 'probe' | 'render'): Response | null;
}

/** A capability's message, in a plugin's own domain: never one its plain `sign` takes. */
const CAPABILITY = 'cap|';

/**
 * A plugin's own signer: what it signs or checks is `plugin|<name length>:<name>|<message>` under the
 * app's key. The length prefix gives each (name, message) pair one spelling, and no region message
 * starts `plugin|` (theirs start with a length), so a plugin signs neither for another
 * plugin nor for a region (test/plugin-signing.test.ts). `capabilities` is its capabilities' signer
 * ({@link plugin_capabilities}); the plain one refuses a capability message.
 */
export function plugin_signer(
	name: string,
	app: CapabilitySigner
): { plain: CapabilitySigner; capabilities: CapabilitySigner } {
	const head = `plugin|${name.length}:${name}|`;
	const plain_message = (message: string) => {
		if (message.startsWith(CAPABILITY))
			throw new OgygiaError('plugin_capability_message', { name });
		return head + message;
	};
	return {
		plain: {
			...app,
			sign: (message) => app.sign(plain_message(message)),
			verify: (message, signature) => app.verify(plain_message(message), signature)
		},
		capabilities: {
			...app,
			sign: (message) => app.sign(head + CAPABILITY + message),
			verify: (message, signature) => app.verify(head + CAPABILITY + message, signature)
		}
	};
}

/** `signer` is the plugin's capabilities' signer ({@link plugin_signer}): it signs `cap|<message>`
 *  in the plugin's domain, so a capability is never the plugin's plain signature of a message. */
export function plugin_capabilities(signer: CapabilitySigner): PluginCapabilities {
	const { lifetime } = signer;
	const refuse = (response: Response): CapabilityOpened => ({ ok: false, response });
	return {
		// a plugin capability seals no session, so it is the anonymous hole of the lifetime rule
		mint(message) {
			const exp = String(lifetime.mint_expiry(''));
			// (the key it names, as a region capability's `&k=`: another deployment can say so)
			return { exp, sig: signer.sign(message(exp)), k: signer.fingerprint() };
		},
		open(event, message): CapabilityOpened {
			const r = region_request.create();
			const { url } = event;
			const params = url.searchParams;
			const exp = params.get('exp') ?? '';
			const renewal = params.get('renew') === '1';
			const now = Math.floor(clock.wall() / 1000); // wall: against the capability's signed epoch expiry
			const refused = expiry_refusal(exp, now, renewal, lifetime.renew_window);
			if (refused) return refuse(signer.deny(refused));
			// (one minted before capabilities named their key carries none: left to the MAC)
			const k = params.get('k');
			if (k !== null && k !== signer.fingerprint()) return refuse(signer.deny('foreign-key'));
			r.go('prechecked');
			r.go('probed');
			const probe = signer.charge(event, 'probe');
			if (probe) return refuse(probe);
			if (!signer.verify(message(exp), params.get('sig') ?? '')) return refuse(signer.deny('sig'));
			r.go('verified');
			r.go('charged');
			const render = signer.charge(event, 'render');
			if (render) return refuse(render);
			if (!renewal) return { ok: true, headers: {} };
			// the same address with a fresh `exp` + `sig` in place (they stay the volatile tail the
			// runtime's region identity cuts off), without the `renew` flag
			const fresh = String(lifetime.renewed_expiry());
			const next = new URLSearchParams(params);
			next.delete('renew');
			next.set('exp', fresh);
			next.set('sig', signer.sign(message(fresh)));
			return { ok: true, headers: { 'x-ogygia-capability': `${url.pathname}?${next}` } };
		}
	};
}
