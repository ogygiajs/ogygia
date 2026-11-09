/**
 * A plugin's own signed capabilities (`app.capability`): the URL of an endpoint the plugin serves
 * (federation's remote-region hole), held to the app's rules for region holes. The same lifetime
 * (server/capability-lifetime.ts), expiry in unix seconds, and the same answer once one expired: a
 * 403 `x-ogygia-deny: expired`, which the runtime retries once with `&renew=1`, re-signed here and
 * handed back in `x-ogygia-capability`. Messages are signed under `cap.<plugin>.`, so a capability
 * never crosses plugins and never passes for a region MAC. Used by plugin/server.ts only.
 */
import type { PluginCapabilities } from './index.ts';
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
export declare function plugin_capabilities(name: string, signer: CapabilitySigner): PluginCapabilities;
