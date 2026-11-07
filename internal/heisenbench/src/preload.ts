/**
 * Loaded before a bench run (`node --import internal/heisenbench/src/preload.ts …`; the bench repo's
 * runner adds it whenever this file exists). Outside Vite, the specifiers only the plugin or Kit
 * serve (`virtual:ogygia/*`, `$app/*`) resolve to the unit-test stubs in packages/core/test/_stubs,
 * the same ones packages/core/vitest.config.ts aliases: `$app/env` -> app-env.ts,
 * `virtual:ogygia/sign` -> virtual-sign.ts.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

const STUBS = new URL('../../../packages/core/test/_stubs/', import.meta.url);
const VIRTUAL = 'virtual:ogygia/';
const APP = '$app/';

function stub_name(specifier: string): string | null {
	if (specifier.startsWith(VIRTUAL)) return 'virtual-' + specifier.slice(VIRTUAL.length);
	if (specifier.startsWith(APP)) return 'app-' + specifier.slice(APP.length);
	return null;
}

registerHooks({
	resolve(specifier, context, next) {
		const name = stub_name(specifier);
		if (name === null) return next(specifier, context);
		const file = new URL(`${name}.ts`, STUBS);
		if (!existsSync(file))
			throw new Error(`heisenbench preload: no stub for ${specifier} (expected ${file.pathname})`);
		return { url: file.href, shortCircuit: true };
	}
});
