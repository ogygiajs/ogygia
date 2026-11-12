import { describe, it, expect } from 'vitest';
// (static: the boot's module graph loaded inside the test body ran past 5 s in a full parallel run)
import { link_boot } from '../src/runtime/boot-link.ts';
import { foreign_region_prop_revivers } from '../src/runtime/foreign-props.ts';

describe('foreign island props membrane', () => {
	it('a wired ref in a foreign sidecar is rejected loudly, never revived cross-build', () => {
		// (a lazy chunk's messages are the boot's: link it, as the runtime's boot does)
		link_boot();
		const revivers = foreign_region_prop_revivers();
		expect(() => revivers.OgygiaRef({} as never)).toThrow(/build boundary.*plain data/s);
	});
});
