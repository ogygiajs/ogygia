/**
 * NATIVE PEERS: packages the app installs itself (sharp; satori, satori-html and resvg for cards),
 * because a server build must not bundle them. One check for each list: is every package installed
 * from the app (found in a `node_modules` folder at or above it, not only through `NODE_PATH`), and
 * where does the app's package.json list them (the least of them counts).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Where the app's package.json lists a package. */
export type Listed = 'none' | 'dev' | 'dependencies';

/** What the app has of a list of peers: whether every one is installed, the least place any is
 *  listed, and the ones it cannot find. */
export interface PeerState {
	installed: boolean;
	listed: Listed;
	missing: string[];
}

function in_node_modules(root: string, name: string): boolean {
	for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, 'node_modules', ...name.split('/'), 'package.json')))
			return true;
		if (path.dirname(dir) === dir) return false;
	}
}

function resolves(root: string, name: string): boolean {
	try {
		createRequire(path.join(root, 'package.json')).resolve(name);
		return true;
		// oxlint-disable-next-line ogygia/no-silent-failures -- not resolving is the answer: the caller names the package
	} catch {
		return false;
	}
}

// @why require.resolve also reads NODE_PATH, which pnpm's bin shims point at its whole store and no deploy has (test: packages/image/test/encoder-check.test.ts › with NODE_PATH set, a sharp that Node finds with no node_modules folder at or above the app is not the app installing it)
function installed(root: string, name: string): boolean {
	if (!resolves(root, name)) return false;
	return !process.env.NODE_PATH || in_node_modules(root, name);
}

const RANK: Readonly<Record<Listed, number>> = { none: 0, dev: 1, dependencies: 2 };

function listed_in(pkg: Record<string, unknown> | null, name: string): Listed {
	const has = (field: string): boolean =>
		typeof (pkg?.[field] as Record<string, unknown> | undefined)?.[name] === 'string';
	if (has('dependencies')) return 'dependencies';
	return has('devDependencies') || has('optionalDependencies') ? 'dev' : 'none';
}

/** What the app at `root` has of the peers `names`. */
export function peer_state(root: string, names: readonly string[]): PeerState {
	const file = path.join(root, 'package.json');
	const pkg = fs.existsSync(file)
		? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
		: null;
	const missing = names.filter((n) => !installed(root, n));
	let listed: Listed = 'dependencies';
	for (const name of names) {
		const l = listed_in(pkg, name);
		if (RANK[l] < RANK[listed]) listed = l;
	}
	return { installed: missing.length === 0, listed, missing };
}
