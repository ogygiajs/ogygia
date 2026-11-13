import { flights } from '@ogygia/machine';
import { load_wire_codec } from 'ogygia:boot';
import { import_again } from './import-again.ts';
import { props_sidecar_of } from './sidecar.ts';
import { slots } from './slots.ts';
import { download } from '../policies.ts';
import { REF_WIRE_KEY } from '../ref-key.ts';

const import_codec = load_wire_codec && /* @__PURE__ */ import_again(load_wire_codec);

const codec_load = /* @__PURE__ */ flights({
	name: 'wire codec',
	run: () => import_codec!().then((m) => m.install()),
	keep: 0,
	retry: download
});

/** The codec's load, when this region's props carry a live value and the codec is not in yet. */
export function wire_for_wake(region: Element): Promise<unknown> | undefined {
	if (load_wire_codec === null || slots.wire) return undefined;
	if (!props_sidecar_of(region)?.textContent?.includes(REF_WIRE_KEY)) return undefined;
	return codec_load.get();
}
