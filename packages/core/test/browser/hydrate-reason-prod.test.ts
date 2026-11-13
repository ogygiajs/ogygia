// Outside dev and devtools, the reason an island drifted is worked out only for a plugin that hears
// `regionMismatched`: with one, it is told why.
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { slots } from '../../src/runtime/slots.ts';
import { hydrate_island } from '../../src/runtime/hydrate-core.ts';
import type { RegionMismatchedEvent } from '../../src/contract/runtime-hooks.ts';
import { claims } from './_walk.ts';

const claims_one = claims(1);

beforeAll(() => {
	link_boot();
});
beforeEach(() => {
	document.body.innerHTML = '';
	vi.stubEnv('DEV', false);
});
afterEach(() => {
	vi.unstubAllEnvs();
	slots.hooks = undefined;
});

test('a plugin hearing regionMismatched is told why the island drifted, in a production build', () => {
	const heard: RegionMismatchedEvent[] = [];
	slots.hooks = { regionMismatched: (e) => void heard.push(e) };
	const region = document.createElement('ogygia-region');
	region.innerHTML = '<!--[--><p>a</p><!--]-->';
	document.body.append(region);
	const ssr = region.innerHTML;
	region.prepend(document.createElement('style'));
	hydrate_island(region, '/a', claims_one, ssr, true);
	expect(heard).toHaveLength(1);
	expect(heard[0].reason).toContain('<style>');
});
