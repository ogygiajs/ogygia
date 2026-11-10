import { expect, inject, test } from 'vitest';
import type { ClientPlugin } from '../../src/plugin/client.ts';

const inject_html = () => decodeURIComponent(escape(atob(inject('counter_json_lane_ssr_b64'))));

test('a client plugin boots, and its hooks are subscribed, before the first region on the page hydrates', async () => {
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
		hooks: {
			regionMount() {
				seen.push('region mounted');
			},
			regionHydrated() {
				seen.push('region hydrated');
			}
		}
	};
	document.body.innerHTML = inject_html();
	bootDev([{ name: 'order', client: plugin }]);
	await expect
		.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
			timeout: 20_000
		})
		.toBe(true);
	await expect.poll(() => seen.includes('region hydrated')).toBe(true);
	expect(seen[0]).toBe('boot with 0 hydrated');
	expect(seen.indexOf('region mounted')).toBeLessThan(seen.indexOf('region hydrated'));
});
