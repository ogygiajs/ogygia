/**
 * The BROWSER half of `testing()`: it hands the runtime's hooks to the testing engine a test
 * injected before the page loaded (`withOgygia`, or a driver's `addInitScript`), which records them.
 * A visitor has no engine, so every hook is one global read and nothing more.
 */
import { defineClient, type ClientPlugin } from '@ogygia/core/plugin/client';
import type { RuntimeHookName, RuntimeHooks } from '@ogygia/core/plugin/client';

/** The engine's realm (devtools' testing-script.ts installs it under the same key). */
interface EngineRealm {
	boot(
		kit_page: boolean,
		facts: { readonly dev: boolean; lend(): Promise<typeof import('./realm-loan.ts')> }
	): void;
	hook<K extends RuntimeHookName>(name: K, e: Parameters<RuntimeHooks[K]>[0]): void;
}
const TESTING_REALM_KEY = Symbol.for('ogygia.testing.realm');
const realm = (): EngineRealm | undefined =>
	(globalThis as { [TESTING_REALM_KEY]?: EngineRealm })[TESTING_REALM_KEY];

const client: ClientPlugin = defineClient({
	boot({ kitPage }) {
		realm()?.boot(kitPage, {
			dev: import.meta.env.DEV,
			lend: () => import('./realm-loan.ts')
		});
	},
	hooks: {
		regionMount: (e) => realm()?.hook('regionMount', e),
		regionUnmount: (e) => realm()?.hook('regionUnmount', e),
		regionHydrated: (e) => realm()?.hook('regionHydrated', e),
		regionFailed: (e) => realm()?.hook('regionFailed', e),
		regionWoke: (e) => realm()?.hook('regionWoke', e),
		regionMismatched: (e) => realm()?.hook('regionMismatched', e),
		holeAnswered: (e) => realm()?.hook('holeAnswered', e),
		holeFailed: (e) => realm()?.hook('holeFailed', e),
		holeBatchMissed: (e) => realm()?.hook('holeBatchMissed', e),
		entryFallback: (e) => realm()?.hook('entryFallback', e),
		navStarted: (e) => realm()?.hook('navStarted', e),
		navigated: (e) => realm()?.hook('navigated', e),
		criticalSettled: (e) => realm()?.hook('criticalSettled', e),
		loadStarted: (e) => realm()?.hook('loadStarted', e),
		warning: (e) => realm()?.hook('warning', e)
	}
});

export default client;
