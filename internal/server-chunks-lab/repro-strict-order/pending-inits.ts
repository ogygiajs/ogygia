/**
 * Which of Rolldown's `strictExecutionOrder` init wrappers never settle? Copies a built server
 * (`.svelte-kit/output/server`) next to it, patches Rolldown's `__esmMin` runtime helper to remember
 * every init that returns a promise, imports the entry, and after 3 s prints the ones still pending
 * (the start of each init's body: the inits it awaits).
 *
 *   node repro-strict-order/pending-inits.ts <.svelte-kit/output/server dir> <chunk file with __esmMin>
 */
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [server, chunk] = process.argv.slice(2) as [string, string];
const copy = join(server, '..', 'server-pending-inits');
await rm(copy, { recursive: true, force: true });
await cp(server, copy, { recursive: true });
const file = join(copy, chunk);
const HELPER = 'var __esmMin = (fn, res, err) => () => {';
const source = await readFile(file, 'utf8');
if (!source.includes(HELPER)) throw new Error('no __esmMin helper in ' + chunk);
await writeFile(
	file,
	source.replace(
		HELPER,
		'var __pending = (globalThis.__pending = new Map());\n' +
			'var __esmMin = (fn, res, err) => () => {\n' +
			'\tif (fn && !res) {\n' +
			'\t\tconst body = fn.toString().replace(/\\s+/g, " ").slice(0, 200);\n' +
			'\t\tres = fn((fn = 0));\n' +
			'\t\tif (res && typeof res.then === "function") {\n' +
			'\t\t\tconst p = res;\n' +
			'\t\t\t__pending.set(p, body);\n' +
			'\t\t\tp.then(() => __pending.delete(p), () => __pending.delete(p));\n' +
			'\t\t}\n' +
			'\t\treturn res;\n' +
			'\t}'
	)
);
const pending = globalThis as { __pending?: Map<unknown, string> };
// lives 3 s: then reports and ends the process
setTimeout(() => {
	console.log('still pending after 3 s: ' + (pending.__pending?.size ?? 0));
	for (const body of pending.__pending?.values() ?? []) console.log('  ' + body);
	process.exit(0);
}, 3000);
await import(pathToFileURL(join(copy, 'index.js')).href);
console.log('the entry imported fine');
process.exit(0);
