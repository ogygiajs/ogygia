import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CORE_ROOT_ID, RUNTIME_DIR, RUNTIME_INPUTS, real_posix } from '@ogygia/core/contract';

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

/** What the runtime chunk is made from: the compiler's runtime entry, core's named inputs, and every
 *  `.js` file in `runtime_dir` (none when it is not built yet). */
export function runtime_inputs(runtime_dir: string = RUNTIME_DIR): string[] {
	const inputs = [
		fileURLToPath(new URL('../link/runtime-entry.js', import.meta.url)),
		...RUNTIME_INPUTS
	];
	try {
		for (const name of fs.readdirSync(runtime_dir)) {
			if (name.endsWith('.js')) inputs.push(path.join(runtime_dir, name));
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- dist may lack the runtime until its first build
	} catch {}
	return inputs;
}

/** The first 12 hex of a sha256 over `files`' bytes in order; a file that cannot be read adds nothing. */
export function content_hash(files: readonly string[]): string {
	const h = crypto.createHash('sha256');
	for (const f of files) {
		try {
			h.update(fs.readFileSync(f));
			// oxlint-disable-next-line ogygia/no-silent-failures -- a missing input does not contribute; still the same across both builds
		} catch {}
	}
	return h.digest('hex').slice(0, 12);
}

/** The runtime chunk's source-content hash (the immutable-filename base; feature hash rides on top). */
export const RUNTIME_HASH: string = content_hash(runtime_inputs());
