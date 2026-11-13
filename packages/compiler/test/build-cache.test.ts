// The build cache: one namespaced store under the project's `node_modules/.ogygia` (a tree build
// platforms keep between builds), written so a crash mid-write leaves no torn entry, and never the
// reason a build fails: a root it cannot write is no cache at all.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BuildCache,
	__set_build_cache_root,
	configure_build_cache
} from '../src/compiler/build-cache.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'og-cache-'));

afterEach(() => {
	vi.restoreAllMocks();
	__set_build_cache_root(undefined);
});

describe('BuildCache', () => {
	it("lives in the configured project's node_modules/.ogygia, one directory per namespace", () => {
		const project = tmp();
		configure_build_cache(project);
		const cache = new BuildCache<{ n: number }>('fences');
		cache.set('k', { n: 1 });
		expect(cache.dir()).toBe(path.join(project, 'node_modules', '.ogygia', 'fences'));
		expect(new BuildCache<{ n: number }>('fences').get('k')).toEqual({ n: 1 });
	});

	it('a new project root is probed again', () => {
		const a = tmp();
		const b = tmp();
		configure_build_cache(a);
		expect(new BuildCache('x').dir()).toBe(path.join(a, 'node_modules', '.ogygia', 'x'));
		configure_build_cache(b);
		expect(new BuildCache('x').dir()).toBe(path.join(b, 'node_modules', '.ogygia', 'x'));
	});

	it('an entry is written beside its address and renamed into place', () => {
		__set_build_cache_root(tmp());
		const rename = vi.spyOn(fs, 'renameSync');
		const cache = new BuildCache<number>('ns');
		cache.set('k', 7);
		expect(rename).toHaveBeenCalledTimes(1);
		const [from, to] = rename.mock.calls[0] as [string, string];
		expect(path.dirname(from)).toBe(path.dirname(to));
		expect(to).toBe(path.join(cache.dir()!, 'k.json'));
		expect(fs.readdirSync(cache.dir()!)).toEqual(['k.json']);
	});

	it('a torn or absent entry is a miss', () => {
		__set_build_cache_root(tmp());
		const cache = new BuildCache<number>('ns');
		expect(cache.get('none')).toBe(null);
		fs.writeFileSync(path.join(cache.dir()!, 'torn.json'), '{"a":');
		expect(cache.get('torn')).toBe(null);
	});

	it('a namespace whose directory cannot be made is no cache, and nothing throws', () => {
		const root = tmp();
		fs.writeFileSync(path.join(root, 'taken'), '');
		__set_build_cache_root(root);
		const cache = new BuildCache<number>('taken');
		expect(cache.dir()).toBe(null);
		expect(cache.get('k')).toBe(null);
	});

	it('a value it cannot write is not kept, and nothing throws', () => {
		__set_build_cache_root(tmp());
		const cache = new BuildCache<bigint>('ns');
		expect(() => cache.set('k', 1n)).not.toThrow();
		expect(cache.get('k')).toBe(null);
	});

	it('a root it cannot create is no cache, and nothing throws', () => {
		const file = path.join(tmp(), 'a-file');
		fs.writeFileSync(file, '');
		configure_build_cache(file);
		const cache = new BuildCache<number>('ns');
		expect(cache.dir()).toBe(null);
		expect(() => cache.set('k', 1)).not.toThrow();
		expect(cache.get('k')).toBe(null);
	});
});
