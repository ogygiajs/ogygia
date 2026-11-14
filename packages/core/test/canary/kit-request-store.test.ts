/**
 * CANARY (#1724): the reads of Kit's private request store ogygia keeps
 * (src/server/kit-request-store.ts), against every Kit the workspace installs. Every event read
 * goes through Kit's public `getRequestEvent()`; these are what it does not cover: the request's
 * `state.remote` (`data`, `implicit`) and running code inside a request.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { broke, KITS, type Internal } from './upstream.ts';

const STORE: Internal = {
	upstream: "SvelteKit's request store (`@sveltejs/kit/internal/server`)",
	used_by: [
		'packages/core/src/server/kit-request-store.ts',
		'packages/core/src/hooks.ts (the remote seed)',
		'packages/core/src/plugin/server.ts (app.keepAlive)',
		'packages/core/src/plugin/testing.ts (inRequest)'
	],
	issue: 1724
};

interface KitServer {
	try_get_request_store(): { event: unknown; state: unknown } | null;
	with_request_store<T>(store: { event: unknown; state: unknown } | null, fn: () => T): T;
	getRequestEvent(): unknown;
}

async function internal_server(root: string): Promise<Partial<KitServer>> {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
		exports: Record<string, { import?: string }>;
	};
	const entry = pkg.exports['./internal/server']?.import;
	expect(entry, broke(STORE, 'the package exports no `./internal/server` entry')).toBeTruthy();
	const mod = (await import(pathToFileURL(path.join(root, entry!)).href)) as Partial<KitServer>;
	await new Promise((r) => setTimeout(r, 0));
	return mod;
}

/** The member names of `interface <name>` in a declaration file, and of each member's own object
 *  type (`remote: { data; implicit }` → `remote.data`, `remote.implicit`). */
function members(file: string, name: string): Set<string> {
	const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
	const out = new Set<string>();
	const walk = (node: ts.Node): void => {
		if (ts.isInterfaceDeclaration(node) && node.name.text === name)
			for (const m of node.members) {
				if (!m.name || !ts.isIdentifier(m.name)) continue;
				out.add(m.name.text);
				if (ts.isPropertySignature(m) && m.type && ts.isTypeLiteralNode(m.type))
					for (const inner of m.type.members)
						if (inner.name && ts.isIdentifier(inner.name))
							out.add(`${m.name.text}.${inner.name.text}`);
			}
		ts.forEachChild(node, walk);
	};
	walk(source);
	return out;
}

describe.each(Object.entries(KITS))("%s's request store", (_, root) => {
	it('exports the three functions ogygia calls', async () => {
		const kit = await internal_server(root);
		for (const fn of ['try_get_request_store', 'with_request_store', 'getRequestEvent'] as const)
			expect(typeof kit[fn], broke(STORE, `\`${fn}\` is no longer a function there`)).toBe(
				'function'
			);
	});

	it('hands back the store a request runs in, through an await, and null outside one', async () => {
		const kit = (await internal_server(root)) as KitServer;
		const store = { event: { url: new URL('https://app.test/') }, state: { remote: {} } };
		await kit.with_request_store(store, async () => {
			await new Promise((r) => setTimeout(r, 1));
			expect(kit.try_get_request_store(), broke(STORE, 'the store is not the one run with')).toBe(
				store
			);
			expect(kit.getRequestEvent(), broke(STORE, '`getRequestEvent()` is not `store.event`')).toBe(
				store.event
			);
		});
		expect(kit.try_get_request_store(), broke(STORE, 'a store outlives its request')).toBeNull();
	});

	it("declares the store's `event` and `state`, and the state's `remote` maps", () => {
		const types = path.join(root, 'src/types/internal.d.ts');
		const store = members(types, 'RequestStore');
		const state = members(types, 'RequestState');
		for (const name of ['event', 'state'])
			expect(store.has(name), broke(STORE, `RequestStore has no \`${name}\``)).toBe(true);
		for (const name of ['remote', 'remote.data', 'remote.implicit'])
			expect(state.has(name), broke(STORE, `RequestState has no \`${name}\``)).toBe(true);
	});
});
