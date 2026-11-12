/**
 * THE WIRE CODEC, loaded when an island's props need it in a build that left it out. The compiler
 * puts the codec in a build up front when it sees a live value cross into an island (a wire class,
 * a portable snippet), but it cannot see every prop: a forwarded `children`, a snippet handed on as
 * a prop, a spread of `$props()`. The server knows: it wrote an `OgygiaRef` into the props sidecar.
 * So a wake whose sidecar holds one loads the codec beside the island's module and the hydrate
 * core, and the props parse finds it installed (test/browser/wire-on-use.test.ts).
 *
 * In a build with the codec (runtime-flags `WIRE`) the element never calls this, and the bundler
 * drops it. A download that fails is tried again at once, and a failure is never kept.
 *
 * @packageDocumentation
 */
import { flights } from '@ogygia/machine';
import { import_again } from './import-again.ts';
import { props_sidecar_of } from './sidecar.ts';
import { slots } from './slots.ts';
import { download } from '../policies.ts';
import { REF_WIRE_KEY } from '../ref-key.ts';

const import_codec = import_again(() => import('../live-transport.ts'));

const codec_load = flights({
	name: 'wire codec',
	run: () => import_codec().then((m) => m.install()),
	retry: download
});

/** The codec's load, when this region's props carry a live value and the codec is not in yet. */
export function wire_for_wake(region: Element): Promise<unknown> | undefined {
	if (slots.wire) return undefined;
	if (!props_sidecar_of(region)?.textContent?.includes(REF_WIRE_KEY)) return undefined;
	return codec_load.get();
}
