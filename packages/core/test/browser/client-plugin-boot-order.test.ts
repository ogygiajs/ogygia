import { expect, inject, test } from 'vitest';
import type { ClientPlugin } from '../../src/plugin/client.ts';

const inject_html = () => decodeURIComponent(escape(atob(inject('counter_json_lane_ssr_b64'))));

test('a client plugin boots before the first region on the page hydrates', async () => {
	(globalThis as { __OGYGIA_CLIENT_PLUGINS__?: boolean }).__OGYGIA_CLIENT_PLUGINS__ = true;
	const [{ bootDev }] = await Promise.all([
		import('../../src/runtime/full.ts'),
		import('/test/browser/fixtures/Counter.svelte'),
		import('../../src/runtime/hydrate-core.ts')
	]);
	const seen: string[] = [];
	const plugin: ClientPlugin = {
		boot() {
			const hydrated = document.querySelectorAll('ogygia-region[data-hydrated]').length;
			seen.push(`boot with ${hydrated} hydrated`);
		},
		regionMount() {
			seen.push('region mounted');
		}
	};
	document.body.innerHTML = inject_html();
	bootDev([plugin]);
	await expect
		.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
			timeout: 20_000
		})
		.toBe(true);
	expect(seen[0]).toBe('boot with 0 hydrated');
	expect(seen).toContain('region mounted');
});
