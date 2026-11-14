// The harness's own sessions compile, or every oracle on them compares refusals (#1601): a build
// session begins its legs as Vite's `buildStart` does, so each leg's transform of a page compiles it.
import { describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { memory_fs } from '../../../packages/compiler/src/fs.ts';
import { LIB, ROUTES } from '../src/app.ts';
import { session, transform_module } from '../src/session.ts';

const PAGE = `${ROUTES}/+page.svelte`;
const files = {
	[`${LIB}/Counter.svelte`]: '<button>+</button>\n',
	[`${ROUTES}/+layout.ts`]: 'export const csr = false;\n',
	[PAGE]: dedent`
		<script>
			import Counter from '$lib/Counter.svelte' with { wake: 'visible' };
		</script>
		<Counter />
	`
};

describe('a harness session', () => {
	it.each([false, true])('dev %s: each leg compiles the page', async (dev) => {
		const s = session(memory_fs(files), { dev });
		s.compiler.prescan();
		for (const leg of ['ssr', 'client'] as const) {
			const out = await transform_module(s, PAGE, leg);
			expect(typeof out, `${leg}: ${JSON.stringify(out)}`).toBe('string');
			expect(out).toContain('ogygia:region/');
		}
	});
});
