/**
 * Each boot helper's place in the boot link (./boot-link.ts `BootLink`): the
 * lazy chunks read the link by number, so no helper's name ships in the boot or in a lazy chunk.
 * Constants alone, each under 1000: the boot and its lazy chunks both import this module, and the
 * bundler inlines a shared number into each chunk only while it prints in three characters or
 * fewer (packages/compiler/test/runtime-boot-svelte-free.test.ts), so this module never becomes a
 * file of its own. test/browser/boot-link-index.test.ts checks each place holds its helper.
 *
 * @internal
 */
export const L_KIT_HYDRATES_PAGE = 0;
export const L_KIT_BOOT = 1;
export const L_ABSOLUTE_URL_SCHEME = 2;
export const L_REGISTER_ISLAND_GRAPH = 3;
export const L_IS_WARMED_MODULE = 4;
export const L_WARM_ISLAND_MODULE = 5;
export const L_RUNS_ENTRY = 6;
export const L_NOTE_ENTRY_LOCATION = 7;
export const L_PROPS_SIDECAR_OF = 8;
export const L_PARSE_REGION_HTML = 9;
export const L_PARSE_PAGE_DOCUMENT = 10;
export const L_INIT_SHADOW_REGISTRIES = 11;
export const L_SET_INNER_HTML = 12;
export const L_VOUCH_PAGE_ANSWER = 13;
export const L_VOUCH_PAGE_HTML = 14;
export const L_RUNTIME_SESSION = 15;
export const L_REGIONS_IN_SHADOW = 16;
export const L_SHEETS_IN_USE = 17;
export const L_YIELD_TASK = 18;
export const L_HOOKS = 19;
export const L_WALK_ENTERS = 20;
export const L_IS_SELF_OWNED = 21;
export const L_RECORD_SERVER_BODY = 22;
export const L_SERVER_BODY_ATTRIBUTES = 23;
export const L_SERVER_BODY_CHILD = 24;
export const L_SERVER_CHANNEL = 25;
export const L_ADOPT_RESPONSE = 26;
export const L_LOAD_SLOT = 27;
export const L_PRIORITY = 28;
export const L_FETCH_PRIORITY_OF = 29;
export const L_LOAD_DEVALUE = 30;
export const L_DEVALUE = 31;
export const L_WITH_DEVALUE = 32;
export const L_NEEDS_DEVALUE = 33;
export const L_OGYGIA_ERROR = 34;
export const L_WARN = 35;
export const L_STALE = 36;
export const L_SOFT = 37;
export const L_IS_DEFERRED = 38;
export const L_OURS_ON_KIT_DOCUMENT = 39;
export const L_REGION_SSR_TRUNCATED = 40;
export const L_MORPH = 41;
export const L_SYNC_ATTRIBUTES = 42;
export const L_LAKE_HOLD = 43;
export const L_LAKE_RELEASE = 44;
export const L_LAKE_SETTLE_IN = 45;
export const L_FORMS_SNAPSHOT = 46;
export const L_FORMS_RESTORE = 47;
export const L_FRAMES_SUBSCRIBE = 48;
export const L_FRAMES_PEEK = 49;
export const L_FRAMES_TICKET = 50;
export const L_FRAMES_STREAM = 51;
export const L_ROUTER = 52;
export const L_JUMP_TO_HASH = 53;
export const L_FRAGMENT_TARGET = 54;
export const L_RESOLVE_ADDRESS = 55;
export const L_WIRE_CODEC = 56;
export const L_SRCSET_CANDIDATES = 57;
