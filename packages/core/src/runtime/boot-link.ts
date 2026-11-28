/**
 * THE BOOT'S LINK: the boot helpers, session state and boot features the runtime's lazy chunks (the
 * hydrate core, the router's navigation, interaction replay) use. The boot hands it to each as it
 * imports it (`m.init(link_boot())`), and they never import these modules: a module the boot and a
 * lazy chunk both import is shared, and Kit's client build (`preserveEntrySignatures: 'strict'`)
 * forbids the runtime chunk from exporting it, so the bundler splits every such module into a file
 * of its own (the runtime's boot arrived as nine). `test/runtime-boot-svelte-free.test.ts` pins that
 * no lazy chunk imports a boot module. A place for a feature the build leaves out holds `null`.
 *
 * The link is a list, read by number (`boot_link()[L_PROPS_SIDECAR_OF]`, ./boot-link-index.ts), so
 * no helper's name ships: its places are this tuple's, in order.
 */
import { STALE } from '@ogygia/machine';
import { create_soft_refresh } from './soft-refresh.ts';
import { kit_hydrates_page } from './kit-boot.ts';
import { KitBoot, kit_meta_of } from '../wire-markup.ts';
import { HAS } from 'ogygia:boot';
import { lazy_hooks } from 'ogygia:boot/hooks';
import { forms, frames, interaction, lakes, morph, router } from 'ogygia:boot/feature-code';
import {
	F_FORMS,
	F_FRAMES,
	F_GRAPH,
	F_INTERACTION,
	F_LAKES,
	F_MORPH,
	F_ROUTER
} from '../contract/features.ts';
import { ABSOLUTE_URL_SCHEME } from './region-endpoint-url.ts';
import { is_warmed_module, warm_island_module } from './island-warm.ts';
import { register_island_graph } from './island-graph-preload.ts';
import { note_entry_location } from './entry-locations.ts';
import {
	is_deferred,
	ours_on_kit_document,
	region_ssr_truncated,
	runs_entry
} from './region-attrs.ts';
import { props_sidecar_of } from './sidecar.ts';
import {
	init_shadow_registries,
	parse_page_document,
	parse_region_html,
	set_inner_html,
	vouch_page_answer,
	vouch_page_html
} from './html-sink.ts';
import { runtime_session } from './session.ts';
import { regions_in_shadow } from './connected.ts';
import { sheets_in_use } from './region-sheets.ts';
import { yield_task } from './schedule.ts';
import {
	is_self_owned,
	record_server_body,
	server_body_attributes,
	server_body_child,
	walk_enters
} from './ownership.ts';
import { LoadSlot } from './load-scheduler.ts';
import { adopt_response, server_channel } from './response-mark.ts';
import { env_served_to } from './kit-env-first.ts';
import { KIT_ENV } from './import-again.ts';
import { fetch_priority_of, PRIORITY } from './load-class.ts';
import { load_devalue, devalue, with_devalue, needs_devalue } from './devalue-lane.ts';
import { OgygiaError, warn } from '../messages/core.ts';
import { wire_codec } from './wire-on-use.ts';
import { srcset_candidates } from '../srcset.ts';

type Lakes = typeof import('./lakes.ts');
type Forms = typeof import('./form-continuity.ts');
type SourceFrames = typeof import('./frames.ts');

export type BootLink = [
	kit_hydrates_page: typeof import('./kit-boot.ts').kit_hydrates_page,
	KitBoot: { document_has(doc: ParentNode): boolean },
	ABSOLUTE_URL_SCHEME: RegExp,
	register_island_graph: typeof import('./island-graph-preload.ts').register_island_graph,
	is_warmed_module: typeof import('./island-warm.ts').is_warmed_module,
	warm_island_module: typeof import('./island-warm.ts').warm_island_module,
	runs_entry: typeof import('./region-attrs.ts').runs_entry,
	note_entry_location: typeof import('./entry-locations.ts').note_entry_location,
	props_sidecar_of: typeof import('./sidecar.ts').props_sidecar_of,
	parse_region_html: typeof import('./html-sink.ts').parse_region_html,
	parse_page_document: typeof import('./html-sink.ts').parse_page_document,
	init_shadow_registries: typeof import('./html-sink.ts').init_shadow_registries,
	set_inner_html: typeof import('./html-sink.ts').set_inner_html,
	vouch_page_answer: typeof import('./html-sink.ts').vouch_page_answer,
	vouch_page_html: typeof import('./html-sink.ts').vouch_page_html,
	runtime_session: typeof import('./session.ts').runtime_session,
	regions_in_shadow: typeof import('./connected.ts').regions_in_shadow,
	sheets_in_use: typeof import('./region-sheets.ts').sheets_in_use,
	yield_task: typeof import('./schedule.ts').yield_task,
	hooks: import('../contract/runtime-hooks.ts').LazyHooks | 0,
	/** DOM ownership (./ownership.ts): which children Svelte's walk enters, and self-owned elements */
	walk_enters: typeof import('./ownership.ts').walk_enters,
	is_self_owned: typeof import('./ownership.ts').is_self_owned,
	/** `<body>`'s two owners (./ownership.ts): the router's record of what the server sent it */
	record_server_body: typeof import('./ownership.ts').record_server_body,
	server_body_attributes: typeof import('./ownership.ts').server_body_attributes,
	server_body_child: typeof import('./ownership.ts').server_body_child,
	/** a document's side channels, the server's own only (./response-mark.ts, RESPONSE-MARK) */
	server_channel: typeof import('./response-mark.ts').server_channel,
	/** the kept runtime script takes the next response's mark and code origins (./response-mark.ts) */
	adopt_response: typeof import('./response-mark.ts').adopt_response,
	/** the load scheduler's queue (./load-scheduler.ts), and a load class as a flight priority and
	 *  as a fetch priority (./load-class.ts) */
	LoadSlot: typeof import('./load-scheduler.ts').LoadSlot,
	PRIORITY: typeof import('./load-class.ts').PRIORITY,
	fetch_priority_of: typeof import('./load-class.ts').fetch_priority_of,
	/** devalue, loaded when a page needs it (./devalue-lane.ts) */
	load_devalue: typeof import('./devalue-lane.ts').load_devalue,
	devalue: typeof import('./devalue-lane.ts').devalue,
	with_devalue: typeof import('./devalue-lane.ts').with_devalue,
	needs_devalue: typeof import('./devalue-lane.ts').needs_devalue,
	/** the runtime's messages (../messages/core.ts), as a lazy chunk throws and logs them (../messages/lazy.ts) */
	OgygiaError: typeof import('../messages/core.ts').OgygiaError,
	warn: typeof import('../messages/core.ts').warn,
	/** what a machine's task answers once its visit is left (`@ogygia/machine`, which the boot runs on) */
	STALE: typeof import('@ogygia/machine').STALE,
	/** the page's soft refresh (./soft-refresh.ts): `invalidateAll`, with the router or without it */
	soft: import('./soft-refresh.ts').SoftRefresh,
	is_deferred: typeof import('./region-attrs.ts').is_deferred,
	ours_on_kit_document: typeof import('./region-attrs.ts').ours_on_kit_document,
	region_ssr_truncated: typeof import('./region-attrs.ts').region_ssr_truncated | null,
	morph: typeof import('./morph.ts').morph_children | null,
	sync_attributes: typeof import('./morph.ts').sync_attributes | null,
	lake_hold: Lakes['hold'] | null,
	lake_release: Lakes['release'] | null,
	lake_settle_in: Lakes['settle_in'] | null,
	forms_snapshot: Forms['snapshot_forms'] | null,
	forms_restore: Forms['arm_form_restore'] | null,
	frames_subscribe: SourceFrames['subscribe'] | null,
	frames_peek: SourceFrames['peek'] | null,
	frames_ticket: SourceFrames['ticket'] | null,
	frames_stream: SourceFrames['stream'] | null,
	router_on: 0 | 1,
	jump_to_hash: typeof import('./router.ts').jump_to_hash | null,
	fragment_target: typeof import('./fragment.ts').fragment_target | null,
	resolve_address: typeof import('./interaction.ts').resolve_address | null,
	wire_codec: typeof import('./wire-on-use.ts').wire_codec,
	srcset_candidates: typeof import('../srcset.ts').srcset_candidates,
	/** a fetched prerendered page's ask for the served env (./kit-env-first.ts), where Kit has one */
	env_served_to: typeof import('./kit-env-first.ts').env_served_to | null
];

const KIT_PAGES = typeof __OGYGIA_KIT_PAGES__ !== 'undefined' ? __OGYGIA_KIT_PAGES__ : true;
const FORMS_ON =
	typeof __OGYGIA_CONTINUITY_FORMS__ !== 'undefined' ? __OGYGIA_CONTINUITY_FORMS__ : true;
const KIT_META = { document_has: (doc: ParentNode): boolean => kit_meta_of(doc) === true };
const no_kit = (): boolean => false;
const no_graph: typeof register_island_graph = () => {};

/** A lazy chunk, as the boot imports it: it takes the boot's link (./lazy-link.ts `init`). */
export type LazyChunk = { init(link: BootLink): void };

let made: BootLink | null = null;

/** `chunk`, handed the boot's link: every import of a lazy chunk the boot makes ends here. */
export function linked<T extends LazyChunk>(chunk: T): T {
	chunk.init(link_boot());
	return chunk;
}

/** The boot's link (made on first ask, then the same list): what the boot hands each lazy chunk it
 *  imports. A test that imports a lazy module without booting hands it this too. */
export function link_boot(): BootLink {
	return (made ??= make_boot_link());
}

/** A boot link, made from the build's word as it stands (its soft refresh a new machine): the boot
 *  makes one ({@link link_boot}). */
export function make_boot_link(): BootLink {
	return [
		KIT_PAGES ? kit_hydrates_page : no_kit,
		KIT_PAGES ? KitBoot : KIT_META,
		ABSOLUTE_URL_SCHEME,
		HAS & F_GRAPH ? register_island_graph : no_graph,
		is_warmed_module,
		warm_island_module,
		runs_entry,
		note_entry_location,
		props_sidecar_of,
		parse_region_html,
		parse_page_document,
		init_shadow_registries,
		set_inner_html,
		vouch_page_answer,
		vouch_page_html,
		runtime_session,
		regions_in_shadow,
		sheets_in_use,
		yield_task,
		lazy_hooks,
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
		create_soft_refresh(),
		is_deferred,
		KIT_PAGES ? ours_on_kit_document : no_kit,
		import.meta.env.DEV ? region_ssr_truncated : null,
		HAS & F_MORPH ? morph.morph_children : null,
		HAS & F_MORPH ? morph.sync_attributes : null,
		HAS & F_LAKES ? lakes.hold : null,
		HAS & F_LAKES ? lakes.release : null,
		HAS & F_LAKES ? lakes.settle_in : null,
		HAS & F_FORMS && FORMS_ON ? forms.snapshot_forms : null,
		HAS & F_FORMS && FORMS_ON ? forms.arm_form_restore : null,
		HAS & F_FRAMES ? (frames as unknown as SourceFrames).subscribe : null,
		HAS & F_FRAMES ? (frames as unknown as SourceFrames).peek : null,
		HAS & F_FRAMES ? frames.ticket : null,
		HAS & F_FRAMES ? (frames as unknown as SourceFrames).stream : null,
		HAS & F_ROUTER ? 1 : 0,
		HAS & F_ROUTER ? router.jump_to_hash : null,
		HAS & F_ROUTER ? router.fragment_target : null,
		HAS & F_INTERACTION ? interaction.resolve_address : null,
		wire_codec,
		srcset_candidates,
		KIT_ENV ? env_served_to : null
	];
}
