// What `ref-watch.ts` states about the watch channel, against the source (#512).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { batch, notify, watch, watcher_count, watchers } from '../src/ref-watch.ts';
import * as ref from '../src/ref.ts';

const SRC = path.resolve(__dirname, '../src');

/** Every module `entry` reaches through static, non-type imports and re-exports. */
function static_graph(entry: string): Set<string> {
	const seen = new Set<string>();
	const stack = [entry];
	while (stack.length > 0) {
		const file = stack.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
		for (const stmt of sf.statements) {
			let spec: ts.Expression | undefined;
			if (
				ts.isImportDeclaration(stmt) &&
				stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
			)
				spec = stmt.moduleSpecifier;
			if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) spec = stmt.moduleSpecifier;
			if (spec === undefined || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue;
			const base = path.resolve(path.dirname(file), spec.text);
			const found = [base, `${base}.ts`].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
			if (found !== undefined) stack.push(found);
		}
	}
	return seen;
}

describe('ref-watch claims', () => {
	it('the region frame store reaches the watch channel without the identity hub', () => {
		const graph = static_graph(path.join(SRC, 'runtime/frame-store.ts'));
		expect(graph.has(path.join(SRC, 'ref-watch.ts'))).toBe(true);
		expect(graph.has(path.join(SRC, 'ref.ts'))).toBe(false);
	});

	it('ref.ts re-exports the same channel, so both entry points share one', () => {
		expect([ref.watch, ref.notify, ref.batch, ref.watcher_count]).toEqual([
			watch,
			notify,
			batch,
			watcher_count
		]);
	});

	it('a second copy of the module shares the realm’s watchers', async () => {
		// (a query makes vitest evaluate the module a second time)
		const second: unknown = await import(
			// @ts-expect-error: no types for a query specifier
			'../src/ref-watch.ts?second-copy'
		);
		const copy = second as typeof import('../src/ref-watch.ts');
		expect(copy.watchers).not.toBe(watchers);
		expect(copy.watchers()).toBe(watchers());
		const seen: unknown[] = [];
		const off = watch('claims-realm', (v) => seen.push(v));
		copy.notify('claims-realm', 1);
		off();
		expect(seen).toEqual([1]);
	});

	it('a watcher added while watchers run waits for the next notify; one removed still runs this time', () => {
		const seen: string[] = [];
		let off_late: () => void = () => {};
		let off_b: () => void = () => {};
		const off_a = watch('claims-copy', () => {
			seen.push('a');
			off_b();
			off_late = watch('claims-copy', () => seen.push('late'));
		});
		off_b = watch('claims-copy', () => seen.push('b'));
		notify('claims-copy', 1);
		expect(seen).toEqual(['a', 'b']);
		off_a();
		off_late();
	});

	it('a throwing watcher is reported and the next one still runs', () => {
		const reported: unknown[] = [];
		const g = globalThis as { reportError?: (e: unknown) => void };
		const before = g.reportError;
		g.reportError = (e) => reported.push(e);
		const boom = new Error('watcher threw');
		const seen: unknown[] = [];
		const off_a = watch('claims-throw', () => {
			throw boom;
		});
		const off_b = watch('claims-throw', (v) => seen.push(v));
		try {
			notify('claims-throw', 7);
		} finally {
			g.reportError = before;
			off_a();
			off_b();
		}
		expect(reported).toEqual([boom]);
		expect(seen).toEqual([7]);
	});

	it('a nested batch notifies nothing until the outermost batch ends, each id once with its last value', () => {
		const seen: Array<[string, unknown]> = [];
		const off_x = watch('claims-x', (v) => seen.push(['x', v]));
		const off_y = watch('claims-y', (v) => seen.push(['y', v]));
		batch(() => {
			notify('claims-x', 1);
			batch(() => {
				notify('claims-y', 1);
				notify('claims-x', 2);
			});
			expect(seen).toEqual([]);
			notify('claims-y', 2);
		});
		off_x();
		off_y();
		expect(seen).toEqual([
			['x', 2],
			['y', 2]
		]);
	});

	it('a batch that throws still flushes what it buffered, and the channel is not left buffering', () => {
		const seen: unknown[] = [];
		const off = watch('claims-throwing-batch', (v) => seen.push(v));
		expect(() =>
			batch(() => {
				notify('claims-throwing-batch', 1);
				throw new Error('decode failed');
			})
		).toThrow('decode failed');
		expect(seen).toEqual([1]);
		notify('claims-throwing-batch', 2);
		off();
		expect(seen).toEqual([1, 2]);
	});
});
