// Region's props written the way a test reads best (each setting a prop of its own, the compiler's
// old shape: `__mode`, `__entry`, `idle`, …), turned into what Region takes: its settings in one
// `__og` object, its reactive props (`__props`, `children`, `of`, …) beside it.
type Props = Record<string, unknown>;

const RENAMED: Readonly<Record<string, string>> = {
	__mode: 'mode',
	__baked: 'baked',
	__keep: 'keep',
	__entry: 'entry',
	__component: 'component',
	__css: 'css',
	__load: 'load',
	__defer: 'when',
	__when: 'when',
	__margin: 'margin',
	__module: 'module',
	__cacheTtl: 'cacheTtl',
	__stitch: 'stitch',
	__prefetch: 'prefetch',
	__remount: 'remount',
	__maxAge: 'maxAge',
	__onExpire: 'onExpire',
	__hydrate: 'wake',
	__hydrateMargin: 'wakeMargin'
};
const WAKE_FLAGS: ReadonlySet<string> = new Set([
	'visible',
	'idle',
	'media',
	'load',
	'interaction'
]);

/** An island's schedule from its wake flags, as the compiler once wrote them (one of the five). */
function wake_of(flags: Props): Props {
	const { visible, idle, media, interaction } = flags;
	const settings: Props = {};
	if (media) settings.wake = media;
	else if (idle) settings.wake = 'idle';
	else if (visible) settings.wake = 'visible';
	else if (interaction) settings.wake = 'interaction';
	if (typeof visible === 'string') settings.wakeMargin = visible;
	return settings;
}

/** `flat`'s settings folded into `__og`; every other prop kept as it is. */
export function region_props(flat: Props): Props {
	const out: Props = {};
	const settings: Props = {};
	const flags: Props = {};
	let any = false;
	for (const [key, value] of Object.entries(flat)) {
		if (key in RENAMED) {
			any = true;
			if (value !== undefined) settings[RENAMED[key]!] = value;
		} else if (WAKE_FLAGS.has(key)) {
			any = true;
			flags[key] = value;
		} else out[key] = value;
	}
	if (any) out.__og = { ...settings, ...wake_of(flags) };
	return out;
}
