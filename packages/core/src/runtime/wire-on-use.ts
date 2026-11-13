/**
 * THE WIRE CODEC, loaded when an island's props need it in a build that left it out. The compiler
 * puts the codec in a build up front when it sees a live value cross into an island (a wire class,
 * a portable snippet), but it cannot see every prop: a forwarded `children`, a snippet handed on as
 * a prop, a spread of `$props()`. The server knows: it wrote an `OgygiaRef` into the props sidecar.
 * So a wake whose sidecar holds one loads the codec beside the island's module and the hydrate
 * core, and the props parse finds it installed (test/browser/wire-on-use.test.ts).
 *
 * In a build with the codec (runtime-flags `load_wire_codec` is `null`) this answers nothing, and
 * the bundler drops it. A download that fails is tried again at once, and a failure is never kept.
 *
 * @packageDocumentation
 */
import { flights } from '@ogygia/machine';
import { load_wire_codec } from 'ogygia:boot';
import { import_again } from './import-again.ts';
import { props_sidecar_of } from './sidecar.ts';
import { slots } from './slots.ts';
import { download } from '../policies.ts';
import { REF_WIRE_KEY } from '../ref-key.ts';

// null in a build with the codec: then all below folds out (the boot-file budget,
// apps/palaestra/e2e/lazy-chunks.spec.ts), so the calls are pure
const import_codec = load_wire_codec && /* @__PURE__ */ import_again(load_wire_codec);

const codec_load = /* @__PURE__ */ flights({
	name: 'wire codec',
	run: () => import_codec!().then((m) => m.install()),
	// once installed, `slots.wire` answers every later wake: a kept answer would never be read
	keep: 0,
	retry: download
});

/** The codec's load, when this region's props carry a live value and the codec is not in yet. */
export function wire_for_wake(region: Element): Promise<unknown> | undefined {
	// the imported constant, not `import_codec`: the bundler folds only an imported `null`
	if (load_wire_codec === null || slots.wire) return undefined;
	if (!props_sidecar_of(region)?.textContent?.includes(REF_WIRE_KEY)) return undefined;
	return codec_load.get();
}
