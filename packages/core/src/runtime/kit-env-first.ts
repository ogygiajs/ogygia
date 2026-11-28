/**
 * KIT'S ENV BEFORE A PRERENDERED PAGE'S REGIONS (KIT-PUBLIC-ENV). A prerendered page's HTML is the
 * build's, so the server writes no env value into it, only its marked ask for the deployed one
 * (server/env-seed.ts). Kit's patched `$app/env/public` reads its env as it first runs, so every
 * region's code waits here for Kit's `_app/env.js` (runtime/kit-env.ts `serve_kit_env`) before its
 * import starts. Every other page waits for nothing and loads nothing. Boot module; folds out of a
 * build whose Kit is not 3 or later.
 *
 * @packageDocumentation
 */
import { plainFlights } from '@ogygia/machine';
import { import_again, import_served, on_code_load } from './import-again.ts';
import { code_url_or_refuse } from './code-origins.ts';
import { server_channel } from './response-mark.ts';
import { KIT_ENV_SERVED_TYPE } from '../kit-env-served.ts';

const SERVED_SELECTOR = `script[type="${KIT_ENV_SERVED_TYPE}"]`;

const import_reader = /* @__PURE__ */ import_again(() => import('ogygia:boot/kit-env'));
const served = /* @__PURE__ */ plainFlights({
	name: 'kit env',
	run: () =>
		import_reader().then((m) => m.serve_kit_env((url) => import_served(code_url_or_refuse(url))))
});

/** The served env, on its way or in: what a region's code waits for. */
function env_served(): Promise<unknown> {
	const env = served.get();
	// oxlint-disable-next-line ogygia/no-silent-failures -- the failure is the reader's to say: a module that reads the env says kit_env_missing (unserved), and one that reads none needs none
	return env.catch(() => null);
}

const asked_by = (doc: Document) =>
	server_channel(doc, SERVED_SELECTOR) === null ? null : env_served();

/** Starts the served env when `doc` (a fetched page, before it is the open one) asks for it. */
export function env_served_to(doc: Document): void {
	// oxlint-disable-next-line ogygia/no-silent-failures -- it never rejects (`env_served`): the region's code that waits for it hears how it went
	void asked_by(doc);
}

function env_first(): Promise<unknown> | null {
	return served.peek() === undefined ? asked_by(document) : env_served();
}

/** Makes every region's code wait for the served env of a page that asks for it (the boot does). */
export function hold_code_for_env(): void {
	on_code_load(env_first);
}
