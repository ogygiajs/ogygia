// ─────────────────────────────────────────────────────────────────────────────
// preload(region) — the one escape hatch for "fetch now, activate later" (the eager case).
//
// A `render: deferred` / `render: live` region fetches when it WAKES. Sometimes you want the HTML on
// screen fast but the region's own schedule to stay lazy (a below-the-fold hole whose content should
// still paint immediately). `preload(region)` warms that region's address in the frame store now, so a
// bound binder paints as soon as the frame lands — while its `wake` schedule still governs when it
// otherwise fetches. Because the store dedupes by address, the binder JOINS this warm instead of
// firing its own request (see runtime/frame-store `ensure`).
//
// Takes only a region value (from `region()` / a query that returns one). Client-only; a no-op on the
// server and for regions with nothing to fetch (inline/dual, or content already baked into the ticket).
// ─────────────────────────────────────────────────────────────────────────────
import { REGION_BRAND } from './region-brand.ts';
import { frameAddress } from './frame.ts';
import { ensure, renew } from './runtime/frame-store.ts';
import { fetch_hole } from './runtime/hole-fetch.ts';
import { PRIORITY } from './runtime/load-class.ts';

export function preload(region: unknown): void {
	if (typeof document === 'undefined') return; // client-only warm (the store is inert on the server)
	const r = region as Record<PropertyKey, unknown> | null;
	if (!r || r[REGION_BRAND] !== true) return; // not a region value — nothing to preload
	const url = typeof r.url === 'string' ? r.url : '';
	if (!url || r.html != null) return; // inline/dual (no url), or the HTML is already baked in — no hole
	const address = frameAddress(url);
	// The hole's own fetch (runtime/hole-fetch.ts), so the store holds what the element would have
	// stored: a 204 is the keep-fallback marker, a page or a redirect is refused (nothing stored), and
	// a renewed capability is the address's.
	// (the app asked for it now: a warm the region's own `prefetch` has waiting is raised to it)
	void ensure(
		address,
		(signal) => fetch_hole(url, { signal, renewed: (fresh) => renew(address, fresh) }),
		{ priority: PRIORITY.user }
	).catch(() => {}); // ok: a failed warm is harmless; the bound region falls back to its own fetch, which says its failure
}
