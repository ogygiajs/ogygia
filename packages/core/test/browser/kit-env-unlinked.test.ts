// KIT'S ENV AS A REGION'S MODULE FIRST RUNS (KIT-PUBLIC-ENV): Kit's patched `$app/env/public` runs as
// soon as a region's module runs. The runtime loads a region's module beside the hydrate core, and the
// hover warm loads it before the replay chunk, so it can run before any lazy chunk took the boot's
// link. This file never links one (no `init`). Each test reads its own copy of the island (its own
// query).
import { afterEach, expect, test, vi } from 'vitest';
import { stringify } from 'devalue';
import { boot_link_or_null } from '../../src/runtime/lazy-link.ts';
import { FIXTURE_BUILD } from './fixtures/reads-kit-env.ts';

const ISLAND = '/test/browser/fixtures/reads-kit-env.ts';
const island = async (copy: string): Promise<Record<string, unknown>> =>
	(
		(await import(/* @vite-ignore */ `${ISLAND}?${copy}`)) as {
			env: Record<string, unknown>;
		}
	).env;

const placed: Element[] = [];
/** The page as the server sends it: its head runtime script and its env channel bear `mark`, and
 *  the channel is the env `build` wrote. */
function page(mark: string, build: string, env: Record<string, unknown>): void {
	const runtime = document.createElement('script');
	runtime.type = 'application/x-runtime-stand-in';
	runtime.setAttribute('data-ogygia-runtime', '');
	runtime.setAttribute('data-og-mark', mark);
	const channel = document.createElement('script');
	channel.type = 'application/ogygia-env';
	channel.setAttribute('data-og-mark', mark);
	channel.textContent = stringify({ build, env });
	document.head.prepend(runtime);
	document.body.append(channel);
	placed.push(runtime, channel);
}
afterEach(() => {
	for (const el of placed.splice(0)) el.remove();
	vi.restoreAllMocks();
});

test("a region's module that runs before any lazy chunk took the boot's link reads the env its page carries", async () => {
	expect(boot_link_or_null()).toBeNull();
	page('a'.repeat(24), FIXTURE_BUILD, { PUBLIC_REGION: 'eu' });
	const said = vi.spyOn(console, 'warn').mockImplementation(() => {});
	expect(await island('unlinked')).toEqual({ PUBLIC_REGION: 'eu' });
	expect(said.mock.calls.flat().join(' ')).not.toContain('kit_env_missing');
});
