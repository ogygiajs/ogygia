import { describe, expect, it } from 'vitest';
import { defineRun, defining, registry, scope } from '../src/index.ts';

describe('registry: live entries, each owned', () => {
	it('iterates in add order', () => {
		const r = registry<string>();
		const owner = scope();
		r.add('a', owner);
		r.add('b', owner);
		r.add('c', owner);
		expect([...r]).toEqual(['a', 'b', 'c']);
		expect(r.size).toBe(3);
	});

	it('an owner ending removes exactly its own entries', () => {
		const r = registry<string>();
		const one = scope();
		const two = scope();
		r.add('a', one);
		r.add('b', two);
		r.add('c', one);
		one.close();
		expect([...r]).toEqual(['b']);
		two.close();
		expect([...r]).toEqual([]);
	});

	it('the removal takes its entry out, once, and leaves nothing behind in its owner', () => {
		const r = registry<string>();
		const owner = scope();
		const remove = r.add('a', owner);
		r.add('a', owner); // (the same value twice is two entries)
		remove();
		remove();
		expect([...r]).toEqual(['a']);
		owner.close();
		expect([...r]).toEqual([]);
	});

	it('adding with an owner that already ended is refused: nothing is added', () => {
		const r = registry<string>();
		const owner = scope();
		owner.close();
		const remove = r.add('a', owner);
		expect([...r]).toEqual([]);
		remove(); // (a no-op)
	});

	it('nothing is ever evicted: as many entries as their owners keep', () => {
		const r = registry<number>();
		const owner = scope();
		for (let i = 0; i < 5000; i++) r.add(i, owner);
		expect(r.size).toBe(5000);
	});

	it('an entry removed while the registry is walked is not walked after', () => {
		const r = registry<string>();
		const owner = scope();
		const removes = ['a', 'b', 'c'].map((v) => r.add(v, owner));
		const seen: string[] = [];
		for (const v of r) {
			seen.push(v);
			if (v === 'a') removes[1]!();
		}
		expect(seen).toEqual(['a', 'c']);
	});
});

describe('keyed registry: definitions by name, each owned by its defining module', () => {
	it('a definition is found by its key; one set again under its key replaces the old', () => {
		const defs = registry.keyed<string, number>();
		const mod = scope();
		defs.set('a', 1, mod);
		defs.set('b', 2, mod);
		defs.set('a', 3, mod);
		expect(defs.get('a')).toBe(3);
		expect([...defs.entries()]).toEqual([
			['b', 2],
			['a', 3]
		]);
		expect(defs.size).toBe(2);
	});

	it("an owner's end ends its definitions: one not set again is gone, one set again stays", () => {
		const defs = registry.keyed<string, string>();
		// a module's first run defines two
		const first = scope();
		defs.set('kept', 'v1', first);
		defs.set('deleted', 'v1', first);
		// a dev reload: its old run ends, its new run defines one of them
		first.close();
		const second = scope();
		defs.set('kept', 'v2', second);
		expect([...defs.entries()]).toEqual([['kept', 'v2']]);
		expect(defs.has('deleted')).toBe(false);
	});

	it('another module cannot take a definition away by ending: only its own go', () => {
		const defs = registry.keyed<string, string>();
		const one = scope();
		const two = scope();
		defs.set('x', 'one', one);
		defs.set('x', 'two', two); // (redefined elsewhere: the later one holds it)
		one.close();
		expect(defs.get('x')).toBe('two');
		two.close();
		expect(defs.get('x')).toBeUndefined();
	});

	it('setting with an owner that already ended is refused', () => {
		const defs = registry.keyed<string, number>();
		const gone = scope();
		gone.close();
		defs.set('a', 1, gone);
		expect(defs.has('a')).toBe(false);
	});
});

describe('definer calls: each module run owns what it defines', () => {
	it('inside a marked call, defining() is the run; outside, null', () => {
		const run = defineRun('/app/a.ts');
		let seen: unknown = 'unset';
		run(() => (seen = defining()))();
		expect(seen).not.toBeNull();
		expect(defining()).toBeNull();
	});

	it("a module's next run ends its last one: a definition the new run does not make is gone", () => {
		const defs = registry.keyed<string, number>();
		const define = (key: string, v: number) => defs.set(key, v, defining()!);
		const first = defineRun('/app/flags.ts');
		first(define)('kept', 1);
		first(define)('deleted', 1);
		const second = defineRun('/app/flags.ts');
		second(define)('kept', 2);
		expect([...defs.entries()]).toEqual([['kept', 2]]);
	});

	it("another module's run does not end this one's", () => {
		const defs = registry.keyed<string, number>();
		const define = (key: string, v: number) => defs.set(key, v, defining()!);
		defineRun('/app/a.ts')(define)('a', 1);
		defineRun('/app/b.ts')(define)('b', 1);
		expect(defs.has('a')).toBe(true);
	});

	it('defining() is restored after a nested call and after a throw', () => {
		const outer = defineRun('/app/outer.ts');
		const inner = defineRun('/app/inner.ts');
		let in_outer: unknown = null;
		outer(() => {
			try {
				inner(() => {
					throw new Error('x');
				})();
			} catch {
				// ok: the throw is the test's
			}
			in_outer = defining();
		})();
		expect(in_outer).not.toBeNull();
		expect(defining()).toBeNull();
	});
});
