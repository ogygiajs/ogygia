/**
 * Path resolution for the Vite adapter. Core's own files come from core (`CORE_ROOT` and the files
 * `@ogygia/core/contract` names); this module adds what the compiler knows: the scan patterns and the
 * runtime chunk's content hash, whose inputs include the compiler's own runtime entry.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CORE_ROOT_ID, RUNTIME_DIR, RUNTIME_INPUTS, real_posix } from '@ogygia/core/contract';

// Glob metacharacters in a file path handed to `optimizeDeps.entries` (Vite globs entries as
// PATTERNS): a route group `(catalog)`, a param dir `[slug]`, `{a,b}`, `*`, `?`, `!`. Escaped, or the
// scanner would read the directory name as glob syntax and never match the file.
const GLOB_META_RE = /[()[\]{}*?!]/g;

/** An island file as an `optimizeDeps.entries` pattern, or null for one of ogygia's OWN islands (the
 *  profiler UI): ogygia is in `optimizeDeps.exclude`, so the scanner can't resolve inside it, and one
 *  unresolved import fails the whole scan (nothing pre-bundles). Its client deps are named up front
 *  instead (the plugin's `dev_island_deps`). */
export function scan_entry_pattern(file: string, own_root: string = CORE_ROOT_ID): string | null {
	const posix = real_posix(file);
	return posix.startsWith(own_root) ? null : posix.replace(GLOB_META_RE, '\\$&');
}

export const KIT_REMOTE_CLIENT: RegExp = /(^|\/)client\.js$/;
export const KIT_REMOTE_STATE: RegExp = /state\.svelte\.js$/;

// Content-hash the runtime's real inputs (the prebuilt dist files the runtime chunk bundles).
// Kit builds the SERVER bundle BEFORE the client, so a forward handoff of the client chunk's hash
// is impossible — but a SOURCE-content hash is deterministic, so both builds compute the SAME
// filename independently and agree. (Standalone mode still overrides this with the real output
// chunk hash; this is its fallback + the Kit-driven answer.)
function runtime_content_hash(): string {
	const inputs = [
		fileURLToPath(new URL('../link/runtime-entry.js', import.meta.url)),
		...RUNTIME_INPUTS
	];
	// Every runtime module (core + feature impls + slots) — any change must bust the sticky filename.
	try {
		for (const name of fs.readdirSync(RUNTIME_DIR)) {
			if (name.endsWith('.js')) inputs.push(path.join(RUNTIME_DIR, name));
		}
	} catch {
		// ok: dist may lack the runtime until its first build
	}
	const h = crypto.createHash('sha256');
	for (const f of inputs) {
		try {
			h.update(fs.readFileSync(f));
		} catch {
			// ok: a missing input does not contribute; still the same across both builds
		}
	}
	return h.digest('hex').slice(0, 12);
}

/** The runtime chunk's source-content hash (the immutable-filename base; feature hash rides on top). */
export const RUNTIME_HASH: string = runtime_content_hash();
