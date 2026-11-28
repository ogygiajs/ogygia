// The boot link is a list the lazy chunks read by number (src/runtime/boot-link-index.ts): no
// helper's name ships. Two helpers of one type in swapped places would still typecheck, so each place
// is checked against the helper it names.
import { expect, test } from 'vitest';
import { STALE } from '@ogygia/machine';
import { link_boot } from '../../src/runtime/boot-link.ts';
import * as index from '../../src/runtime/boot-link-index.ts';
import { morph_children, sync_attributes } from '../../src/runtime/morph.ts';
import { hold, release, settle_in } from '../../src/runtime/lakes.ts';
import { arm_form_restore, snapshot_forms } from '../../src/runtime/form-continuity.ts';
import { peek, stream, subscribe, ticket } from '../../src/runtime/frames.ts';
import { fragment_target, jump_to_hash } from '../../src/runtime/router.ts';
import { resolve_address } from '../../src/runtime/interaction.ts';
import { wire_codec } from '../../src/runtime/wire-on-use.ts';
import { kit_hydrates_page } from '../../src/runtime/kit-boot.ts';
import { KitBoot } from '../../src/wire-markup.ts';
import { ABSOLUTE_URL_SCHEME } from '../../src/runtime/region-endpoint-url.ts';
import { is_warmed_module, warm_island_module } from '../../src/runtime/island-warm.ts';
import { register_island_graph } from '../../src/runtime/island-graph-preload.ts';
import { note_entry_location } from '../../src/runtime/entry-locations.ts';
import {
	is_deferred,
	ours_on_kit_document,
	region_ssr_truncated,
	runs_entry
} from '../../src/runtime/region-attrs.ts';
import { props_sidecar_of } from '../../src/runtime/sidecar.ts';
import {
	init_shadow_registries,
	parse_page_document,
	parse_region_html,
	set_inner_html,
	vouch_page_answer,
	vouch_page_html
} from '../../src/runtime/html-sink.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { regions_in_shadow } from '../../src/runtime/connected.ts';
import { sheets_in_use } from '../../src/runtime/region-sheets.ts';
import { yield_task } from '../../src/runtime/schedule.ts';
import { lazy_hooks } from 'ogygia:boot/hooks';
import {
	is_self_owned,
	record_server_body,
	server_body_attributes,
	server_body_child,
	walk_enters
} from '../../src/runtime/ownership.ts';
import { LoadSlot } from '../../src/runtime/load-scheduler.ts';
import { adopt_response, server_channel } from '../../src/runtime/response-mark.ts';
import { fetch_priority_of, PRIORITY } from '../../src/runtime/load-class.ts';
import {
	devalue,
	load_devalue,
	needs_devalue,
	with_devalue
} from '../../src/runtime/devalue-lane.ts';
import { OgygiaError, warn } from '../../src/messages/core.ts';
import { srcset_candidates } from '../../src/srcset.ts';

const link = link_boot();

test('each place in the boot link holds the helper its number names', () => {
	const want: Record<string, unknown> = {
		L_KIT_HYDRATES_PAGE: kit_hydrates_page,
		L_KIT_BOOT: KitBoot,
		L_ABSOLUTE_URL_SCHEME: ABSOLUTE_URL_SCHEME,
		L_REGISTER_ISLAND_GRAPH: register_island_graph,
		L_IS_WARMED_MODULE: is_warmed_module,
		L_WARM_ISLAND_MODULE: warm_island_module,
		L_RUNS_ENTRY: runs_entry,
		L_NOTE_ENTRY_LOCATION: note_entry_location,
		L_PROPS_SIDECAR_OF: props_sidecar_of,
		L_PARSE_REGION_HTML: parse_region_html,
		L_PARSE_PAGE_DOCUMENT: parse_page_document,
		L_INIT_SHADOW_REGISTRIES: init_shadow_registries,
		L_SET_INNER_HTML: set_inner_html,
		L_VOUCH_PAGE_ANSWER: vouch_page_answer,
		L_VOUCH_PAGE_HTML: vouch_page_html,
		L_RUNTIME_SESSION: runtime_session,
		L_REGIONS_IN_SHADOW: regions_in_shadow,
		L_SHEETS_IN_USE: sheets_in_use,
		L_YIELD_TASK: yield_task,
		// (the test build keeps every hook: the subscribers' runner, not its no-op)
		L_HOOKS: lazy_hooks,
		L_WALK_ENTERS: walk_enters,
		L_IS_SELF_OWNED: is_self_owned,
		L_RECORD_SERVER_BODY: record_server_body,
		L_SERVER_BODY_ATTRIBUTES: server_body_attributes,
		L_SERVER_BODY_CHILD: server_body_child,
		L_SERVER_CHANNEL: server_channel,
		L_ADOPT_RESPONSE: adopt_response,
		L_LOAD_SLOT: LoadSlot,
		L_PRIORITY: PRIORITY,
		L_FETCH_PRIORITY_OF: fetch_priority_of,
		L_LOAD_DEVALUE: load_devalue,
		L_DEVALUE: devalue,
		L_WITH_DEVALUE: with_devalue,
		L_NEEDS_DEVALUE: needs_devalue,
		L_OGYGIA_ERROR: OgygiaError,
		L_WARN: warn,
		L_STALE: STALE,
		L_IS_DEFERRED: is_deferred,
		L_OURS_ON_KIT_DOCUMENT: ours_on_kit_document,
		// (dev's alone: a production build's place holds null)
		L_REGION_SSR_TRUNCATED: region_ssr_truncated,
		// (the boot features: the test build has every one; a build without one holds null)
		L_MORPH: morph_children,
		L_SYNC_ATTRIBUTES: sync_attributes,
		L_LAKE_HOLD: hold,
		L_LAKE_RELEASE: release,
		L_LAKE_SETTLE_IN: settle_in,
		L_FORMS_SNAPSHOT: snapshot_forms,
		L_FORMS_RESTORE: arm_form_restore,
		L_FRAMES_SUBSCRIBE: subscribe,
		L_FRAMES_PEEK: peek,
		L_FRAMES_TICKET: ticket,
		L_FRAMES_STREAM: stream,
		L_ROUTER: 1,
		L_JUMP_TO_HASH: jump_to_hash,
		L_FRAGMENT_TARGET: fragment_target,
		L_RESOLVE_ADDRESS: resolve_address,
		L_WIRE_CODEC: wire_codec,
		L_SRCSET_CANDIDATES: srcset_candidates,
		L_ENV_SERVED_TO: null
	};
	const places = index as unknown as Record<string, number>;
	for (const [name, helper] of Object.entries(want)) expect(link[places[name]], name).toBe(helper);
	// (the soft refresh is made by the boot: its place holds the one machine of this document)
	expect(link[index.L_SOFT].now.kind).toBe('idle');
	expect(Object.keys(places).sort()).toEqual([...Object.keys(want), 'L_SOFT'].sort());
	expect(link).toHaveLength(Object.keys(places).length);
});

test('the boot makes its link once: every lazy chunk it hands one gets the same list', () => {
	expect(link_boot()).toBe(link);
});

test('every place is a different number, from 0 up with no gap', () => {
	const numbers = Object.values(index as unknown as Record<string, number>).sort((a, b) => a - b);
	expect(numbers).toEqual(numbers.map((_, i) => i));
});
