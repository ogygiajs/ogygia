/**
 * Fill `slots.boot` — the boot helpers and session state the runtime's lazy chunks (the hydrate
 * core, the router's navigation) use. They read them from the registry and never import these
 * modules, so each stays in the runtime chunk alone instead of being split into a shared file
 * (./slots.ts `BootLink` explains why). Core calls this at boot, before any lazy chunk can load; a
 * test that imports a lazy module without booting calls it too. Idempotent.
 */
import { cache, flights, stage, STALE, world } from '@ogygia/machine';
import { slots } from './slots.ts';
import { create_soft_refresh } from './soft-refresh.ts';
import { KitBoot, kit_hydrates_page } from './kit-boot.ts';
import {
	ABSOLUTE_URL_SCHEME,
	is_warmed_module,
	warm_island_module
} from './region-endpoint-url.ts';
import { note_entry_location } from './entry-locations.ts';
import { runs_entry } from './region-attrs.ts';
import { register_island_graph } from './island-graph-preload.ts';
import { props_sidecar_of } from './sidecar.ts';
import {
	parse_page_document,
	parse_region_html,
	set_inner_html,
	vouch_page_answer,
	vouch_page_html
} from './html-sink.ts';
import { runtime_session } from './session.ts';
import { regions_in_shadow } from './connected.ts';
import { release_head_nodes } from './region-sheets.ts';
import { add_head_owners, adopt_owner_record, head_owners } from '../head-owners.ts';
import { yield_task } from './schedule.ts';
import { HOOK_REGION_HYDRATE, client_region_hydrate } from './client-plugins.ts';
import {
	is_self_owned,
	record_server_body,
	server_body_attributes,
	server_body_child,
	walk_enters
} from './ownership.ts';
import { LoadSlot } from './load-scheduler.ts';
import { adopt_response, server_channel } from './response-mark.ts';
import { fetch_priority_of, PRIORITY } from './load-class.ts';
import { load_devalue, devalue, with_devalue, needs_devalue } from './devalue-lane.ts';
import { OgygiaError, warn } from '../messages/core.ts';

const no_region_hydrate: typeof client_region_hydrate = () => null;

export function link_boot(): void {
	slots.boot ??= {
		kit_hydrates_page,
		KitBoot,
		ABSOLUTE_URL_SCHEME,
		register_island_graph,
		is_warmed_module,
		warm_island_module,
		runs_entry,
		note_entry_location,
		props_sidecar_of,
		parse_region_html,
		parse_page_document,
		set_inner_html,
		vouch_page_answer,
		vouch_page_html,
		runtime_session,
		regions_in_shadow,
		release_head_nodes,
		head_owners,
		add_head_owners,
		adopt_owner_record,
		yield_task,
		region_hydrate: HOOK_REGION_HYDRATE ? client_region_hydrate : no_region_hydrate,
		walk_enters,
		is_self_owned,
		record_server_body,
		server_body_attributes,
		server_body_child,
		server_channel,
		adopt_response,
		LoadSlot,
		PRIORITY,
		fetch_priority_of,
		load_devalue,
		devalue,
		with_devalue,
		needs_devalue,
		OgygiaError,
		warn,
		STALE,
		flights,
		cache,
		stage,
		world,
		soft: create_soft_refresh()
	};
}
