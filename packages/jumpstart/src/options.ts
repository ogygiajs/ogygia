import { OgygiaError } from './messages.ts';

/** `jumpstart(options)`. */
export interface JumpstartOptions {
	/**
	 * Packages that stay outside the server bundle, by package name (`'sharp'`, `'@acme/db'`), as
	 * Vite's `resolve.external` takes them. Every other dependency is bundled in. List a package
	 * that cannot be bundled: one with a native addon, one that reads files next to its own module
	 * (`new URL('./data.wasm', import.meta.url)`, `__dirname`), or one that must be a single
	 * instance across the process. A package listed here is imported from `node_modules` at run
	 * time, so the deploy needs it installed.
	 */
	external?: readonly string[];
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(['external']);

/** The options, checked: an unknown key or a non-name in `external` fails the build. */
export class Options {
	readonly external: readonly string[];

	constructor(options: JumpstartOptions = {}) {
		for (const key of Object.keys(options))
			if (!KNOWN_KEYS.has(key)) throw new OgygiaError('jumpstart_option_unknown', { key });
		const external = options.external ?? [];
		if (!Array.isArray(external))
			throw new OgygiaError('jumpstart_external_invalid', { value: String(external) });
		for (const name of external)
			if (typeof name !== 'string' || name === '')
				throw new OgygiaError('jumpstart_external_invalid', { value: String(name) });
		this.external = [...new Set(external)];
	}
}
