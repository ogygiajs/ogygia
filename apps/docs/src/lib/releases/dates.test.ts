// The Releases pages' dates (./dates.ts): a version's date is when npm published it (the registry's
// `time[version]`); a release tag's date stands in when the registry was not reached; neither, none.
// Run by plain node: `node --test src/lib/releases/dates.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dates_from_registry, dates_from_tags, merge_dates } from './dates.ts';

/** A registry document as `GET https://registry.npmjs.org/@ogygia/core` answers, cut down. */
const REGISTRY = {
	name: '@ogygia/core',
	'dist-tags': { latest: '0.13.0' },
	time: {
		created: '2026-08-01T10:00:00.000Z',
		modified: '2026-11-09T22:26:00.000Z',
		'0.12.3': '2026-11-06T09:15:42.123Z',
		'0.13.0': '2026-11-09T22:25:12.512Z',
		'0.13.0-next.1': '2026-11-08T05:00:00.000Z'
	}
};

test("each version's date is its publish day (UTC), keyed by package and version", () => {
	assert.deepEqual(dates_from_registry('@ogygia/core', REGISTRY), {
		'@ogygia/core@0.12.3': '2026-11-06',
		'@ogygia/core@0.13.0': '2026-11-09',
		'@ogygia/core@0.13.0-next.1': '2026-11-08'
	});
});

test('a document without `time` (or not a document) gives no dates', () => {
	assert.deepEqual(dates_from_registry('x', { name: 'x' }), {});
	assert.deepEqual(dates_from_registry('x', null), {});
	assert.deepEqual(dates_from_registry('x', { time: { '1.0.0': 'not a date' } }), {});
});

test("release tags: `<package>@<version> <day>`, and the older `v<version>` tags are ogygia's", () => {
	assert.deepEqual(
		dates_from_tags(
			'@ogygia/core@0.12.3 2026-11-07\nv0.5.0 2026-08-12\narchive/lts-0.8 2026-10-01\n'
		),
		{ '@ogygia/core@0.12.3': '2026-11-07', 'ogygia@0.5.0': '2026-08-12' }
	);
});

test('the registry wins; a tag fills in what the registry did not say', () => {
	assert.deepEqual(
		merge_dates({ 'a@1.0.0': '2026-01-02' }, { 'a@1.0.0': '2026-01-01', 'a@0.9.0': '2025-12-01' }),
		{ 'a@1.0.0': '2026-01-02', 'a@0.9.0': '2025-12-01' }
	);
});
