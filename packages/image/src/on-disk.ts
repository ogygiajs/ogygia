/**
 * The image server realm's Node half: what it reads and notes on disk in the dev server and in the
 * build, never on a live server. ../server.ts loads it only there, so a server bundle for another
 * runtime (Workers) never runs it.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';
import { REMOTE_NAME_RE } from './handoff.ts';

export { note_built, note_origin } from './store.ts';

/** Is `tail` (an original's path from the app's root, or `@fs/` and an absolute path) a remote
 *  image's file in the folder `remote`, there now? */
export function is_remote(root: string, remote: string, tail: string): boolean {
	if (remote === '') return false;
	const file = tail.startsWith('@fs/') ? tail.slice(3) : path.join(root, ...tail.split('/'));
	if (path.dirname(path.resolve(file)) !== path.resolve(remote)) return false;
	const base = path.basename(file);
	return REMOTE_NAME_RE.test(base.slice(0, base.indexOf('.'))) && fs.existsSync(file);
}

/** Is there a file at `rel` (a `/` path) under `dir`? */
export function exists(dir: string, rel: string): boolean {
	return fs.existsSync(path.join(dir, ...rel.split('/')));
}
