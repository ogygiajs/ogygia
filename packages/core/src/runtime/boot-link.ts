/**
 * Fill `slots.boot` — the boot helpers and session state the runtime's lazy chunks (the hydrate
 * core, the router's navigation) use. They read them from the registry and never import these
 * modules, so each stays in the runtime chunk alone instead of being split into a shared file
 * (./slots.ts `BootLink` explains why). Core calls this at boot, before any lazy chunk can load; a
 * test that imports a lazy module without booting calls it too. Idempotent.
 */
import { flights, stage, STALE, world } from '@ogygia/machine';
import { slots } from './slots.ts';
import { create_soft_refresh } from './soft-refresh.ts';
import { KitBoot, kit_hydrates_page } from './kit-boot.ts';
import {
	ABSOLUTE_URL_SCHEME,
	is_warmed_module,
	warm_island_module
} from './region-endpoint-url.ts';
import { note_entry_location } from './entry-locations.ts';
import { register_island_graph } from './island-graph-preload.ts';
import { props_sidecar_of } from './sidecar.ts';
import { parse_region_html } from './parse-html.ts';
import { runtime_session } from './session.ts';
import { regions_in_shadow } from './connected.ts';
import { release_sheets } from './region-sheets.ts';
import { yield_task } from './schedule.ts';
import { beacon_nav } from './beacon.ts';
import { CLIENT_PLUGINS, client_region_hydrate } from './client-plugins.ts';
import {
	is_self_owned,
	record_server_body,
	server_body_attributes,
	server_body_child,
	walk_enters
} from './ownership.ts';
import { LoadSlot } from './load-scheduler.ts';
import { adopt_mark, server_channel } from './response-mark.ts';
import { load_devalue, devalue, with_devalue, needs_devalue } from './devalue-lane.ts';
import { OgygiaError, warn } from '../messages/core.ts';

// (the profiler's browser half ships only where something reads it: see `__OGYGIA_BEACON__`; a
// plain import of dist/ without the define keeps it)
const BEACON = typeof __OGYGIA_BEACON__ !== 'undefined' ? __OGYGIA_BEACON__ : true;
const no_beacon_nav: typeof beacon_nav = () => {};
const no_region_hydrate: typeof client_region_hydrate = () => null;

export function link_boot(): void {
	slots.boot ??= {
		kit_hydrates_page,
		KitBoot,
		ABSOLUTE_URL_SCHEME,
		register_island_graph,
		is_warmed_module,
		warm_island_module,
		note_entry_location,
		props_sidecar_of,
		parse_region_html,
		runtime_session,
		regions_in_shadow,
		release_sheets,
		yield_task,
		beacon_nav: BEACON ? beacon_nav : no_beacon_nav,
		region_hydrate: CLIENT_PLUGINS ? client_region_hydrate : no_region_hydrate,
		walk_enters,
		is_self_owned,
		record_server_body,
		server_body_attributes,
		server_body_child,
		server_channel,
		adopt_mark,
		LoadSlot,
		load_devalue,
		devalue,
		with_devalue,
		needs_devalue,
		OgygiaError,
		warn,
		STALE,
		flights,
		stage,
		world,
		soft: create_soft_refresh()
	};
}
