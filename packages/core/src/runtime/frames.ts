import { slots } from './slots.ts';
import { subscribe, peek, ticket, ensure, renew, renewal } from './frame-store.ts';
import { watch_frames } from './rules.ts';
import { batch_times, join_batch, send_batches } from './frame-nav.ts';
import { adopt_early_holes } from './early-holes.ts';
import { runtime_session } from './session.ts';

const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

export function install(): void {
	if (RULES) watch_frames(peek);
	adopt_early_holes(runtime_session.visit.scope);
	slots.frames = {
		subscribe,
		peek,
		ticket,
		ensure,
		renew,
		renewal,
		stream: (endpoints, visit, page) => send_batches(endpoints, 'nav', visit, page),
		join: join_batch,
		batch_times
	};
}
