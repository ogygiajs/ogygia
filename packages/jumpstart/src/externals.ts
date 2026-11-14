import { isBuiltin } from 'node:module';
import { line } from './messages.ts';

const RELATIVE_RE = /^(?:\.{1,2}\/|\/|[A-Za-z]:[\\/]|\0)/;
const SCOPED_RE = /^(@[^/]+\/[^/]+)/;
const PLAIN_RE = /^([^/]+)/;

/** Why a package stayed outside the server bundle. */
export type ExternalReason = 'jumpstart' | 'config' | 'vite';

const REASON_TEXT: Readonly<Record<ExternalReason, string>> = {
	jumpstart: 'jumpstart({ external })',
	config: 'external in the Vite config',
	vite: 'kept out by Vite or another plugin'
};

/** The package a bare specifier names (`@a/b/c` → `@a/b`, `x/y` → `x`). */
export function package_of(specifier: string): string {
	return (SCOPED_RE.exec(specifier) ?? PLAIN_RE.exec(specifier))?.[1] ?? specifier;
}

/**
 * What the server build still imports from `node_modules` at run time, and why: the build's one
 * line about it (`jumpstart_external`, or `jumpstart_external_none`).
 */
export class Externals {
	readonly #listed: ReadonlySet<string>;
	readonly #config: ReadonlySet<string>;
	readonly #found = new Map<string, ExternalReason>();

	constructor(listed: readonly string[], config: readonly string[]) {
		this.#listed = new Set(listed);
		this.#config = new Set(config);
	}

	/** One import a server chunk kept as written (an external). Relative paths and Node's own
	 *  modules are not packages and are not counted. */
	add(specifier: string): void {
		if (RELATIVE_RE.test(specifier) || isBuiltin(specifier)) return;
		const name = package_of(specifier);
		if (this.#found.has(name)) return;
		this.#found.set(name, this.#reason(specifier, name));
	}

	/** The packages found, by name, with their reasons. */
	get found(): ReadonlyMap<string, ExternalReason> {
		return this.#found;
	}

	/** The line the build prints. */
	report(): string {
		if (this.#found.size === 0) return line('jumpstart_external_none');
		const names = [...this.#found.keys()].sort();
		const list = names.map((n) => `${n} (${REASON_TEXT[this.#found.get(n)!]})`).join(', ');
		return line('jumpstart_external', { count: String(names.length), list });
	}

	#reason(specifier: string, name: string): ExternalReason {
		if (this.#listed.has(name) || this.#listed.has(specifier)) return 'jumpstart';
		if (this.#config.has(name) || this.#config.has(specifier)) return 'config';
		return 'vite';
	}
}
