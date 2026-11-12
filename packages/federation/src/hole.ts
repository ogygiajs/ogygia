/**
 * A DEFERRED remote region — a hole the browser fetches from the SHELL's own handle, which derives
 * the visitor's claims at hole time and forwards to the peer. The hole URL is a shell-signed
 * capability (the browser can choose none of its inputs), so the v1 `proxy()` open-endpoint plus
 * its `widgets` allowlist are gone.
 *
 * The signer lives in the handle (it holds the region secret); this module is import-light and
 * client-safe, so it takes the signer through a `globalThis` + `Symbol.for` seam — the
 * PAGE-STATE-SINGLETON law. On the client (or a server with no federation handle) the seam is
 * unset and the mint degrades to an empty inert region rather than throwing.
 */
import type { DeferredRegion } from '@ogygia/core';
import { slot as shared } from '@ogygia/machine';
import { deferredRegion } from '@ogygia/core/plugin';
import type { Claims } from './wire.ts';

/** A hole of this app's that forwards to a peer: a page of its exposed table, a widget of its
 *  catalog, or one of its own region endpoints that its fragment carries (`target`: its path and
 *  query on the peer's origin). */
export type HoleSpec = {
	peer: string;
	kind: 'page' | 'widget' | 'endpoint';
	target: string;
	search: string;
	claims?: Claims;
};

/** What the handle installs: sign a hole and return its fetch URL, or null if it cannot. */
export type HoleSigner = (spec: HoleSpec) => string | null;

interface HoleSlot {
	signer: HoleSigner | null;
}
const slot = shared<HoleSlot>({
	name: 'ogygia.federation.hole',
	version: 1,
	make: () => ({ signer: null })
});

/** hooks.ts installs the signer once (it holds the region secret). */
export function set_hole_signer(fn: HoleSigner | null): void {
	slot.signer = fn;
}

/** A hole's fetch URL, signed for this request ('' with no signer installed). */
export function hole_url(spec: HoleSpec): string {
	return slot.signer?.(spec) ?? '';
}

/** Build a deferred remote-region value. `target` is the peer path (page) or widget name. */
export function mint_hole(
	peer: string,
	kind: 'page' | 'widget',
	target: string,
	search: string,
	claims?: Claims
): DeferredRegion {
	const url = hole_url({ peer, kind, target, search, claims });
	// A remote fragment brings its OWN islands (they wake themselves once the HTML swaps in); the hole
	// itself is HTML-only, so no hydrate module of its own.
	return deferredRegion(`frag:${peer}:${target}`, url);
}
