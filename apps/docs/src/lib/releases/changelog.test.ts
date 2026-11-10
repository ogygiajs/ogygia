// The changelog reader for the Releases pages (./changelog.ts): a package's CHANGELOG.md as written
// by changesets (and the older dated headings) into releases, each with its kind and its lines as
// safe HTML. Run by plain node: `node --test src/lib/releases/changelog.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { group_by_version, kind_of, read_changelog } from './changelog.ts';

const CORE = `# @ogygia/core

## 0.13.0

### Minor Changes

- [#174](https://github.com/ogygiajs/ogygia/pull/174) [\`413e77f\`](https://github.com/ogygiajs/ogygia/commit/413e77f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A page discloses \`window.__ogygia.v\`.

### Patch Changes

- [#226](https://github.com/ogygiajs/ogygia/pull/226) [\`019b77e\`](https://github.com/ogygiajs/ogygia/commit/019b77e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A barrel saved <mid-transform> is built again.
- Updated dependencies [[\`019b77e\`](https://github.com/ogygiajs/ogygia/commit/019b77e)]:
  - @ogygia/machine@0.13.0

## 0.12.3

### Patch Changes

- [#1](https://github.com/ogygiajs/ogygia/pull/1) [\`a2eade9\`](https://github.com/ogygiajs/ogygia/commit/a2eade9) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A fix.

## 0.13.0-next.1

### Patch Changes

- A pre-release line.

## [0.5.0] — 2026-08-12

### Added

- A dated, older entry with **bold** text.
`;

test('each version heading is a release, newest first, with its package', () => {
	const r = read_changelog('@ogygia/core', CORE);
	assert.deepEqual(
		r.map((x) => x.version),
		['0.13.0', '0.12.3', '0.13.0-next.1', '0.5.0']
	);
	assert.ok(r.every((x) => x.package === '@ogygia/core'));
});

test('a pre-release is marked; a dated heading keeps its date', () => {
	const r = read_changelog('@ogygia/core', CORE);
	assert.equal(r[2].prerelease, true);
	assert.equal(r[0].prerelease, false);
	assert.equal(r[3].date, '2026-08-12');
	assert.equal(r[0].date, null);
});

test('the kind is the part of the version that moved: x.0.0 major, x.y.0 minor, else patch', () => {
	assert.equal(kind_of('1.0.0'), 'major');
	assert.equal(kind_of('0.13.0'), 'minor');
	assert.equal(kind_of('0.12.3'), 'patch');
	assert.equal(kind_of('2.0.0-next.1'), 'major');
	const r = read_changelog('@ogygia/core', CORE);
	assert.equal(r[0].kind, 'minor');
	assert.equal(r[1].kind, 'patch');
});

test('a line keeps its PR and author links, as HTML with its text escaped', () => {
	const [first] = read_changelog('@ogygia/core', CORE);
	const minor = first.groups.find((g) => g.title === 'Minor Changes')!;
	const line = minor.lines[0];
	assert.match(line.html, /<a href="https:\/\/github\.com\/ogygiajs\/ogygia\/pull\/174">#174<\/a>/);
	assert.match(line.html, /<a href="https:\/\/github\.com\/PuruVJ">@PuruVJ<\/a>/);
	assert.match(line.html, /<code>window\.__ogygia\.v<\/code>/);
	const patch = first.groups.find((g) => g.title === 'Patch Changes')!;
	assert.match(patch.lines[0].html, /&lt;mid-transform&gt;/);
	assert.doesNotMatch(patch.lines[0].html, /<mid-transform>/);
});

test('"Updated dependencies" is one short line naming the packages, not the commit list', () => {
	const [first] = read_changelog('@ogygia/core', CORE);
	const patch = first.groups.find((g) => g.title === 'Patch Changes')!;
	assert.deepEqual(first.deps, ['@ogygia/machine@0.13.0']);
	assert.equal(patch.lines.length, 1);
});

test('a link to anything but http(s) is text, never an href', () => {
	const r = read_changelog(
		'x',
		'# x\n\n## 1.0.0\n\n### Major Changes\n\n- [bad](javascript:alert(1)) **b**\n'
	);
	assert.doesNotMatch(r[0].groups[0].lines[0].html, /href/);
	assert.match(r[0].groups[0].lines[0].html, /<strong>b<\/strong>/);
});

test('releases of many packages group by version, newest version first', () => {
	const a = read_changelog('a', '# a\n\n## 0.13.0\n\n- one\n\n## 0.12.0\n\n- two\n');
	const b = read_changelog('b', '# b\n\n## 0.13.0\n\n- three\n');
	const v = group_by_version([...a, ...b]);
	assert.deepEqual(
		v.map((x) => [x.version, x.releases.map((r) => r.package)]),
		[
			['0.13.0', ['a', 'b']],
			['0.12.0', ['a']]
		]
	);
	assert.equal(v[0].kind, 'minor');
});
