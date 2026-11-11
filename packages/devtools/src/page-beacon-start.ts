/**
 * A build's dock starts the page beacon from a lazy chunk, once a browser switched devtools on and the
 * page has no beacon (an app without ogygia's handle gets no beacon tag). A chunk that fails to
 * download, or a beacon that throws as it starts, leaves this page unmeasured and is warned; the next
 * page load asks again. Said once per page. Resolves to whether the beacon started; never rejects.
 */
import { warn } from './messages/runtime.ts';

type BeaconChunk = { standalone_beacon(): void };

/** a failed download was said (once for the page: one reload asks again) */
let failure_said = false;

export function start_page_beacon(
	load: () => Promise<BeaconChunk> = () => import('./profiler/beacon-standalone.ts')
): Promise<boolean> {
	return load()
		.then((m) => {
			m.standalone_beacon();
			return true;
		})
		.catch((error: unknown) => {
			if (!failure_said) {
				failure_said = true;
				warn('devtools_page_beacon_load_failed', {}, error);
			}
			return false;
		});
}
