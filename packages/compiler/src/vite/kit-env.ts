import * as devalue from 'devalue';
import type { ViteDevServer } from 'vite';
import { warn } from '../messages.ts';

/** Kit 3's `$app/env/public` for the browser in dev, as Kit generates it under its out dir. */
export const KIT_DEV_PUBLIC_ENV_RE: RegExp = /\/generated\/dev\/env\/public\/client\.js$/;
const KIT_PAYLOAD_READ = 'const { env } = globalThis.__sveltekit_dev;';
const KIT_ENV_CONFIG = '<sveltekit:generated>/env/config.js';

/** The dev server's SSR module runner (Vite's `RunnableDevEnvironment.runner`), as this reads it. */
export interface SsrRunner {
	import(id: string): Promise<unknown>;
}

/** The dev server's SSR runner, or null where its SSR environment is not a runnable one. */
export function ssr_runner(server: ViteDevServer | null): SsrRunner | null {
	const ssr = server?.environments?.ssr as { runner?: SsrRunner } | undefined;
	return ssr?.runner ?? null;
}

/**
 * Kit 3's dev `$app/env/public` module for the browser, made to read on a document Kit never boots.
 * Kit's module reads its boot payload (`globalThis.__sveltekit_dev`), which only Kit's client boot
 * writes, so on a `csr = false` page a region whose code imports it threw on import. It reads that
 * payload where Kit booted, and otherwise the env Kit renders into it (`rendered_env`, from the dev
 * server's own server module), so the module gives the same values on both kinds of page.
 * Null: nothing to change (Kit wrote an empty module: the app declares no variables).
 */
export async function kit_dev_public_env(
	code: string,
	id: string,
	runner: SsrRunner | null
): Promise<string | null> {
	if (code.trim() === '') return null;
	if (!code.includes(KIT_PAYLOAD_READ) || runner === null) {
		warn('kit_dev_env_unread', { file: id });
		return null;
	}
	const config = (await runner.import(KIT_ENV_CONFIG)) as { rendered_env?: unknown };
	if (config.rendered_env === null || typeof config.rendered_env !== 'object') {
		warn('kit_dev_env_unread', { file: id });
		return null;
	}
	const read = `const { env } = globalThis.__sveltekit_dev ?? { env: ${devalue.uneval(config.rendered_env)} };`;
	return code.replace(KIT_PAYLOAD_READ, () => read);
}
