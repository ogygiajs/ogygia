/**
 * A plugin's own signed capabilities (`app.capability`): the URL of an endpoint the plugin serves
 * (federation's remote-region hole), held to the app's rules for region holes. The same lifetime
 * (server/capability-lifetime.ts), expiry in unix seconds, and the same answer once one expired: a
 * 403 `x-ogygia-deny: expired`, which the runtime retries once with `&renew=1`, re-signed here and
 * handed back in `x-ogygia-capability`. Messages are signed under `cap.<plugin>.`, so a capability
 * never crosses plugins and never passes for a region MAC. Used by plugin/server.ts only.
 */
import type { CapabilityOpened, PluginCapabilities } from './index.ts';
import { expiry_refusal } from '../server/shared-cache.ts';
import type { CapabilityLifetime } from '../server/capability-lifetime.ts';

/** Why a plugin capability is refused (the region endpoint's reasons of the same name). */
export type CapabilityDeny = 'expired' | 'renew-window' | 'sig';

/** What the handle hands in: the app's key, its hole lifetime, and the refusal a region request
 *  gets. (Handed in, never imported: this module stays free of the app's virtual modules, so the
 *  plugin test harness runs it as it is.) */
export interface CapabilitySigner {
	sign(message: string): string;
	verify(message: string, signature: string): boolean;
	lifetime: CapabilityLifetime;
	deny(why: CapabilityDeny): Response;
}

export function plugin_capabilities(name: string, signer: CapabilitySigner): PluginCapabilities {
	const scoped = (message: string) => `cap.${name}.${message}`;
	const { lifetime } = signer;
	return {
		// a plugin capability seals no session, so it is the anonymous hole of the lifetime rule
		mint(message) {
			const exp = String(lifetime.mint_expiry(''));
			return { exp, sig: signer.sign(scoped(message(exp))) };
		},
		open(url, message): CapabilityOpened {
			const params = url.searchParams;
			const exp = params.get('exp') ?? '';
			const renewal = params.get('renew') === '1';
			const now = Math.floor(Date.now() / 1000);
			const refused = expiry_refusal(exp, now, renewal, lifetime.renew_window);
			if (refused) return { ok: false, response: signer.deny(refused) };
			if (!signer.verify(scoped(message(exp)), params.get('sig') ?? ''))
				return { ok: false, response: signer.deny('sig') };
			if (!renewal) return { ok: true, headers: {} };
			// the same address with a fresh `exp` + `sig` in place (they stay the volatile tail the
			// runtime's region identity cuts off), without the `renew` flag
			const fresh = String(lifetime.renewed_expiry());
			const next = new URLSearchParams(params);
			next.delete('renew');
			next.set('exp', fresh);
			next.set('sig', signer.sign(scoped(message(fresh))));
			return { ok: true, headers: { 'x-ogygia-capability': `${url.pathname}?${next}` } };
		}
	};
}
