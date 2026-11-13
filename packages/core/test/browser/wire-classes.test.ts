// The transportable classes an island needs, loaded before it decodes its props
// (runtime/wire-classes.ts). Its own file: the class loaders are read once, when the module loads.
import { afterEach, expect, test } from 'vitest';
import { wire_loaders } from '../_stubs/region.transportables.ts';

const loaded: string[] = [];
let fail: string | null = null;
const loader = (path: string) =>
	[
		async () => {
			loaded.push(path);
			if (fail === path) throw new Error(`${path} did not download`);
		},
		null,
		import.meta.url
	] as const;
for (const path of ['app/a', 'app/b', 'app/c', 'app/d', 'app/e', 'app/f'])
	wire_loaders[path] = loader(path);

const { wire_classes_for } = await import('../../src/runtime/wire-classes.ts');

/** A region whose props sidecar names `classes`. */
function region(classes: string): Element {
	const host = document.createElement('div');
	const el = document.createElement('ogygia-region');
	const sidecar = document.createElement('script');
	sidecar.type = 'application/json';
	sidecar.setAttribute('data-ogygia-props', '');
	if (classes) sidecar.setAttribute('data-og-wire', classes);
	sidecar.textContent = '{}';
	host.append(el, sidecar);
	document.body.append(host);
	return el;
}

function seed(text: string): void {
	for (const s of document.querySelectorAll('script[type="application/ogygia-page"]')) s.remove();
	const s = document.createElement('script');
	s.type = 'application/ogygia-page';
	s.textContent = text;
	document.body.append(s);
}

afterEach(() => {
	document.body.replaceChildren();
	fail = null;
	loaded.length = 0;
});

test('a class module loads once, however many islands need it', async () => {
	await wire_classes_for(region('app/a'));
	await wire_classes_for(region('app/a'));
	expect(loaded).toEqual(['app/a']);
});

test('a class module that fails to download lets the wake go on: its decode then says which is missing', async () => {
	fail = 'app/b';
	await expect(wire_classes_for(region('app/b'))).resolves.toBeDefined();
	expect(loaded).toContain('app/b');
});

test('a class module that failed is not kept: the next wake that needs it loads it afresh', async () => {
	fail = 'app/f';
	await wire_classes_for(region('app/f'));
	const failed = loaded.filter((p) => p === 'app/f').length;
	fail = null;
	await wire_classes_for(region('app/f'));
	expect(loaded.filter((p) => p === 'app/f')).toHaveLength(failed + 1);
	await wire_classes_for(region('app/f'));
	expect(loaded.filter((p) => p === 'app/f')).toHaveLength(failed + 1);
});

test('the context an island reads loads its classes: a provide around it and the page’s context root', async () => {
	seed('{}');
	document.dispatchEvent(new Event('og:after-swap'));
	const provide = document.createElement('ogygia-provide');
	const payload = document.createElement('script');
	payload.type = 'application/json';
	payload.setAttribute('data-ogygia-provide', '');
	payload.textContent = '[{"v":["app/d#1"]}]';
	provide.append(payload);
	const root = document.createElement('script');
	root.type = 'application/json';
	root.setAttribute('data-ogygia-provide-page', '');
	root.textContent = '[{"v":["app/e#1"]}]';
	document.body.append(root, provide);
	const island = region('');
	provide.append(island.parentElement!);
	await wire_classes_for(island);
	expect(loaded.sort()).toEqual(['app/d', 'app/e']);
});

test('the page seed is read again after a navigation swaps the page in', async () => {
	seed('{}');
	expect(wire_classes_for(region(''))).toBeNull();
	seed('[{"x":["app/c#1"]}]');
	document.dispatchEvent(new Event('og:after-swap'));
	await wire_classes_for(region(''));
	expect(loaded).toEqual(['app/c']);
});
