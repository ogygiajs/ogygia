/**
 * THE SERVER'S PORTS: the request-scoped readers and recorders the handle installs (`hooks.ts`) and
 * the render seams call (Region.svelte, the router's document, the profiler). They live in ONE
 * `slot()`, shared by every copy of the module a process loads (dev serves a module twice; an app
 * can bundle core twice), so the copy that installs and the copy that reads are always one. On the
 * browser nothing is installed: the ports are `null` there, and no client chunk carries the slot.
 *
 * @packageDocumentation
 */
import { BROWSER } from 'esm-env';
import { slot } from '@ogygia/machine';
import type { set_tail_reader } from './server/document-tail.ts';
import type {
	set_ask_scope_opener,
	set_page_recorder,
	set_seed_ask_reader
} from './page-seed-registry.ts';
import type {
	set_late_recorder,
	set_late_scope_opener,
	set_late_taker
} from './late-region-registry.ts';
import type { set_ctx_recorder } from './context-registry.ts';
import type { set_server_devtools_recorder } from './events/server-registry.ts';
import type { set_request_stats_sink } from './server/request-stats.ts';
import type { configure_render_page } from './server/render-page.ts';

type Port<F extends (fn: never) => void> = Parameters<F>[0];

/** Every port, `null` until the handle installs it. */
export interface ServerPorts {
	tail_reader: Port<typeof set_tail_reader>;
	page_recorder: Port<typeof set_page_recorder>;
	seed_ask_reader: Port<typeof set_seed_ask_reader>;
	ask_scope_opener: Port<typeof set_ask_scope_opener>;
	late_scope_opener: Port<typeof set_late_scope_opener>;
	late_recorder: Port<typeof set_late_recorder>;
	late_taker: Port<typeof set_late_taker>;
	ctx_recorder: Port<typeof set_ctx_recorder>;
	devtools_recorder: Port<typeof set_server_devtools_recorder>;
	request_stats_sink: Port<typeof set_request_stats_sink>;
	render_page_warn: Port<typeof configure_render_page>['warn'];
}

let held: ServerPorts | undefined;

/** The process's ports; `null` on the browser, where none is ever installed. */
export function server_ports(): ServerPorts | null {
	if (BROWSER) return null;
	return (held ??= slot<ServerPorts>({
		name: 'ogygia.server-ports',
		version: 1,
		make: () => ({
			tail_reader: null,
			page_recorder: null,
			seed_ask_reader: null,
			ask_scope_opener: null,
			late_scope_opener: null,
			late_recorder: null,
			late_taker: null,
			ctx_recorder: null,
			devtools_recorder: null,
			request_stats_sink: null,
			render_page_warn: null
		})
	}));
}
