import { cache, flights } from '@ogygia/machine';
import { wire_loaders, wire_all } from 'ogygia:region';
import { import_again } from './import-again.ts';
import { props_sidecar_of } from './sidecar.ts';
import { yield_task } from './schedule.ts';
import { slots } from './slots.ts';
import { download } from '../policies.ts';
import { OG_WIRE, OGYGIA_PROVIDE, OGYGIA_PROVIDE_PAGE } from '../wire-markup.ts';

/** Feature entry: fill the `wire_classes` slot. */
export function install(): void {
	slots.wire_classes = wire_classes_for;
}

const loaders = wire_loaders;
const paths = Object.keys(loaders);
const imports = cache<string, () => Promise<unknown>>({
	name: 'class module loaders',
	max: Math.max(1, paths.length)
});
const loads = flights({
	name: 'wire class',
	run: (path: string) => {
		let import_class = imports.get(path);
		if (!import_class) {
			const [load, file, base] = loaders[path]!;
			imports.set(path, (import_class = import_again(load, undefined, file, base)));
		}
		return yield_task().then(import_class);
	},
	retry: download
});

function load(path: string): Promise<unknown> {
	if (!loaders[path]) return Promise.resolve();
	// oxlint-disable-next-line ogygia/no-silent-failures -- its decode then says which class is missing
	return loads.get(path).catch(() => undefined);
}

function scan(text: string | null | undefined, want: Set<string>): void {
	if (!text) return;
	for (const p of paths) if (!want.has(p) && text.indexOf(`"${p}#`) !== -1) want.add(p);
}

let seed_classes: { doc: Document; want: Set<string> } | null = null;
function classes_in_seeds(doc: Document): Set<string> {
	if (seed_classes?.doc === doc) return seed_classes.want;
	const want = new Set<string>();
	for (const s of doc.querySelectorAll(
		'script[type="application/ogygia-page"], script[type="application/ogygia-remote"]'
	))
		scan(s.textContent, want);
	seed_classes = { doc, want };
	return want;
}
if (typeof document !== 'undefined')
	// oxlint-disable-next-line ogygia/owned-effects -- the module's own cache reset on each page swap, once per module: it lives as long as the document
	document.addEventListener('og:after-swap', () => (seed_classes = null));

/** The loads this island's props, context and page seeds need, or `null` when none (the common
 *  case: an app without transportables, or an island that carries none). */
export function wire_classes_for(region: Element): Promise<unknown> | null {
	if (!paths.length) return null;
	const want = new Set<string>();
	if (wire_all) for (const p of paths) want.add(p);
	else {
		const stamp = props_sidecar_of(region)?.getAttribute(OG_WIRE);
		if (stamp) for (const p of stamp.split(' ')) if (p) want.add(p);
		for (let el = region.parentElement; el; el = el.parentElement)
			if (el.tagName === 'OGYGIA-PROVIDE')
				scan(el.querySelector(`:scope > script[${OGYGIA_PROVIDE}]`)?.textContent, want);
		const doc = region.ownerDocument;
		scan(doc.querySelector(`script[${OGYGIA_PROVIDE_PAGE}]`)?.textContent, want);
		for (const p of classes_in_seeds(doc)) want.add(p);
	}
	if (!want.size) return null;
	const pending: Promise<unknown>[] = [];
	for (const p of want) pending.push(load(p));
	return Promise.all(pending);
}
