import { kit_hydrates_page } from './kit-boot.ts';
import { OgygiaError } from '../messages/core.ts';

type ClientHooksModule = { init?: (input?: unknown) => unknown };

/**
 * Run the app's `hooks.client.ts` `init()` on a csr=false page. Kit runs that file only when its
 * own client app boots, which a csr=false page never does: ogygia is the client bootstrap there,
 * so it runs the hook itself. On a csr=true document Kit already did, so it is not run again. A failing `init` is reported (`client_hooks_init_failed`) and never thrown.
 */
export function run_app_client_hooks(loader: () => Promise<ClientHooksModule>): void {
	if (typeof document === 'undefined') return;
	// @why Kit boots on a csr=true document and runs hooks.client itself (test: test/browser/client-hooks.test.ts › csr=true document: skipped — Kit runs hooks.client itself, so it must not double-fire)
	if (kit_hydrates_page()) return;
	Promise.resolve()
		.then(loader)
		.then((m) => m.init?.())
		.catch((e) => console.error(new OgygiaError('client_hooks_init_failed'), e));
}
