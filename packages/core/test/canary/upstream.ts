/**
 * THE UPSTREAM CANARIES' SHARED WORDS. ogygia relies on a few Svelte and SvelteKit internals that no
 * public API covers (#1723). Each has one canary test under `test/canary/` (core's and the
 * compiler's), run by every `check` and by the upstream-watch CI job against the next Svelte and
 * Kit releases. When upstream changes one, its canary fails with a message that names the internal,
 * the ogygia code that relies on it, and the issue that tracks it: this module words that message.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

/** One upstream internal ogygia relies on. */
export interface Internal {
	/** What upstream has that ogygia reads: a module, an export, a markup or code shape. */
	upstream: string;
	/** The ogygia files that rely on it. */
	used_by: readonly string[];
	/** The ogygia issue that tracks it. */
	issue: number;
}

/** The failure message of a canary: `internal` changed, in the way `what` says. */
export function broke(internal: Internal, what: string): string {
	return [
		`UPSTREAM CANARY: ${internal.upstream} changed: ${what}.`,
		`ogygia relies on it in ${internal.used_by.join(', ')}.`,
		`See https://github.com/ogygiajs/ogygia/issues/${internal.issue}.`
	].join(' ');
}

const require = createRequire(import.meta.url);
const kit_sources = createRequire(
	path.join(import.meta.dirname, '../../../../internal/kit-sources/package.json')
);

const version_of = (root: string): string =>
	(require(path.join(root, 'package.json')) as { version: string }).version;

/** The root of every SvelteKit the workspace installs, by `Kit <version>`: the one the apps build
 *  with (on upstream-watch, the release under test), and Kit 3 from its own importer
 *  (internal/kit-sources), whose peers never move the versions the apps resolve. */
export const KITS: Readonly<Record<string, string>> = Object.fromEntries(
	[
		path.dirname(require.resolve('@sveltejs/kit/package.json')),
		path.dirname(kit_sources.resolve('@sveltejs/kit3/package.json'))
	].map((root) => [`Kit ${version_of(root)}`, root])
);
