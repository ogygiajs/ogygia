/**
 * THE CAPABILITY LIFETIME — when a signed hole URL minted now expires, and when a renewed one does.
 * One rule for every capability the app signs: core's region holes (server/region-endpoint.ts) and a
 * plugin's own (`app.capability`, plugin/capability.ts — a remote region's hole). Expiry is unix
 * SECONDS everywhere: the runtime reads it from the URL to tell an expired capability
 * (runtime/region-endpoint-url.ts `capability_expired`) and retries it once with `&renew=1`.
 *
 * Pure: the app's settings come in (server/region-endpoint.ts binds them from the virtuals), so the
 * plugin test harness (plugin/testing.ts) runs the same rule without a Kit app.
 */
import { current_facts } from '../plugin/facts.ts';
import { capability_expiry } from './endpoint.ts';
import { document_shared_lifetime, mint_ttl_sec } from './shared-cache.ts';

/** The app's settings the rule reads. */
export interface LifetimeSettings {
	/** prerendering (Kit's `building`) */
	building: boolean;
	/** `ogygia({ ttl })`, seconds */
	region_ttl: number;
	/** `ogygia({ maxPageAge })`, seconds */
	renew_window: number;
	/** the request being rendered (null off-request: prerender, a test) */
	request(): Request | null;
}

export interface CapabilityLifetime {
	/**
	 * The `exp` (unix seconds) of a capability minted now, in the render running now. Prerendered
	 * (real PPR) or a render a plugin may store (`facts.storable`): prerender-grade, since the stored
	 * HTML outlives any `ttl` (a stored page must never carry expired hole URLs). An anonymous hole on
	 * a document the app marked shared-cacheable (a load's `cache-control`) outlives that cache life
	 * (server/shared-cache.ts). Everything else, and anything sealed to a `session`, keeps the short
	 * `ttl` window so harvested URLs age out.
	 */
	mint_expiry(session: string): number;
	/** The `exp` of a capability RENEWED now (an expired one re-signed at hole time): the short `ttl`
	 *  window — its document is already old, and the runtime adopts the fresh URL for later fetches. */
	renewed_expiry(): number;
	/** Seconds after expiry a capability still renews (`0` renews nothing). */
	readonly renew_window: number;
}

export function capability_lifetime(app: LifetimeSettings): CapabilityLifetime {
	const now_sec = () => Math.floor(Date.now() / 1000);
	return {
		mint_expiry(session) {
			const stored = app.building || current_facts()?.storable === true;
			return capability_expiry(
				now_sec(),
				mint_ttl_sec({
					stored,
					session,
					shared: stored || session !== '' ? 0 : document_shared_lifetime(app.request()),
					region_ttl: app.region_ttl
				})
			);
		},
		renewed_expiry: () => capability_expiry(now_sec(), app.region_ttl),
		renew_window: app.renew_window
	};
}
