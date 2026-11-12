import { describe, it, expect } from 'vitest';

describe('foreign island props membrane', () => {
	it('a wired ref in a foreign sidecar is rejected loudly, never revived cross-build', async () => {
		// (a lazy chunk's messages are the boot's: link it, as the runtime's boot does)
		(await import('../src/runtime/boot-link.ts')).link_boot();
		const { foreign_region_prop_revivers } = await import('../src/runtime/foreign-props.ts');
		const revivers = foreign_region_prop_revivers();
		expect(() => revivers.OgygiaRef({} as never)).toThrow(/build boundary.*plain data/s);
	});
});
