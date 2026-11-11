/**
 * THE REALM: what the app's own build feeds the readers (the dock, the testing engine) from the
 * runtime's hooks: the hook record, the beacon's regions half and the leftovers watch. The dock's
 * client runs it; `@ogygia/testing`'s `testing()` hands the hooks to the testing engine a test
 * injects, which runs another copy of it. Each hook call is handled once per page, whichever copy
 * hears it first (devtools/hook-once.ts), so an app with both feeds each reader once.
 */
import type { RuntimeHookName, RuntimeHooks } from '@ogygia/core/plugin/client';
import { record_realm, record_hook } from './devtools/hook-record.ts';
import type { RealmFacts } from './devtools/hook-record-type.ts';
import { first_handling } from './devtools/hook-once.ts';
import {
	watch_leftovers,
	leftover_island_seen,
	leftover_island_gone
} from './devtools/leftovers.ts';
import { install_beacon } from './profiler/beacon.ts';
import { beacon_hook } from './client-beacon.ts';

type Payload<K extends RuntimeHookName> = Parameters<RuntimeHooks[K]>[0];

/** The realm's start, at the runtime's boot: the facts its readers ask for, the beacon's regions
 *  half, and the leftovers watch (from before the first island wakes; a Kit page has no islands). */
export function realm_boot(kit_page: boolean, facts: RealmFacts): void {
	record_realm(facts);
	install_beacon(true);
	if (!kit_page) watch_leftovers();
}

/** One runtime hook call, into the record, the leftovers watch and the beacon. */
export function realm_hook<K extends RuntimeHookName>(name: K, e: Payload<K>): void {
	if (first_handling('record', e)) record_hook(name, e);
	if (name === 'regionMount') {
		const m = e as Payload<'regionMount'>;
		leftover_island_seen(m.el, m.entry, [...m.urls]);
	} else if (name === 'regionUnmount') {
		const u = e as Payload<'regionUnmount'>;
		leftover_island_gone(u.el, u.entry);
	}
	beacon_hook(name, e);
}
