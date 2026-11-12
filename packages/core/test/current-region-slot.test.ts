// CONTEXT-CURSOR (internal/notes/INVARIANTS.md): the region being hydrated, and the foreign island
// being delegated, live on one `Symbol.for` slot each, so two copies of current-region.ts (the
// runtime's and the separately bundled context feature's) read what the other wrote.
import { expect, it, vi } from 'vitest';

async function fresh_copy() {
	vi.resetModules();
	return import('../src/current-region.ts');
}

it('two copies of the module share the region being hydrated, and the foreign island', async () => {
	const runtime = await fresh_copy();
	const feature = await fresh_copy();
	expect(feature).not.toBe(runtime);
	const el = { tagName: 'OGYGIA-REGION' } as unknown as Element;
	runtime.set_current_region(el);
	expect(feature.current_region()).toBe(el);
	runtime.set_current_region(null);
	expect(feature.current_region()).toBeNull();

	const info = { origin: 'https://peer.example', entry: 'https://peer.example/x.js' };
	runtime.set_foreign_hydrate(info);
	expect(feature.foreign_hydrate()).toBe(info);
	runtime.set_foreign_hydrate(null);
});
