/**
 * Git loaders against a real repo (a local bare mirror served over file://): each spec gets the
 * checkout its whole spec names (owner, repo, ref, sub), never another loader's (#288).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { materialize, parse_git_spec, git_glob_pattern } from '../src/macros/git.ts';
import { __set_build_cache_root } from '@ogygia/compiler';

const git = (args: string[], cwd: string) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim();

function write(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

let tmp: string;
let base_url: string;
let root: string;

/** The files a spec's glob finds in its checkout (as the rewritten `import.meta.glob` would). */
function found(spec: string): string[] {
	const pattern = git_glob_pattern(parse_git_spec(spec));
	const dir = path.join(root, pattern.slice(1, pattern.indexOf('/**')));
	if (!fs.existsSync(dir)) return [];
	return (fs.readdirSync(dir, { recursive: true }) as string[])
		.filter((f) => f.endsWith('.md'))
		.map((f) => f.split(path.sep).join('/'))
		.sort();
}

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-git-checkout-'));
	const work = path.join(tmp, 'work');
	fs.mkdirSync(work);
	git(['init', '-q', '-b', 'main'], work);
	git(['config', 'user.email', 'test@example.com'], work);
	git(['config', 'user.name', 'test'], work);
	write(path.join(work, 'docs/intro.md'), '# docs on main');
	write(path.join(work, 'api/ref.md'), '# api on main');
	git(['add', '.'], work);
	git(['commit', '-q', '-m', 'main'], work);
	git(['checkout', '-q', '-b', 'v2'], work);
	write(path.join(work, 'docs/intro.md'), '# docs on v2');
	write(path.join(work, 'docs/new.md'), '# only on v2');
	git(['add', '.'], work);
	git(['commit', '-q', '-m', 'v2'], work);
	git(['checkout', '-q', 'main'], work);
	const mirror = path.join(tmp, 'mirror', 'a', 'b.git');
	fs.mkdirSync(path.dirname(mirror), { recursive: true });
	git(['clone', '-q', '--bare', work, mirror], tmp);
	git(['config', 'uploadpack.allowFilter', 'true'], mirror);
	base_url = 'file://' + path.join(tmp, 'mirror');
	root = path.join(tmp, 'app');
	fs.mkdirSync(root);
	__set_build_cache_root(undefined);
});

afterAll(() => {
	__set_build_cache_root(undefined);
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe('git loaders on one repo', () => {
	it('two loaders with different folders each find their own files', () => {
		materialize(parse_git_spec('a/b:docs'), { root, base_url });
		materialize(parse_git_spec('a/b:api'), { root, base_url });
		expect(found('a/b:docs')).toEqual(['intro.md']);
		expect(found('a/b:api')).toEqual(['ref.md']);
	});

	it('a loader on another ref checks that ref out', () => {
		const main = materialize(parse_git_spec('a/b@main:docs'), { root, base_url });
		const v2 = materialize(parse_git_spec('a/b@v2:docs'), { root, base_url });
		expect(v2.sha).not.toBe(main.sha);
		expect(found('a/b@v2:docs')).toEqual(['intro.md', 'new.md']);
		expect(found('a/b@main:docs')).toEqual(['intro.md']);
		const pattern = git_glob_pattern(parse_git_spec('a/b@v2:docs'));
		const dir = path.join(root, pattern.slice(1, pattern.indexOf('/**')));
		expect(fs.readFileSync(path.join(dir, 'intro.md'), 'utf8')).toBe('# docs on v2');
	});
});
