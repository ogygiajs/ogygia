/**
 * The devtools message tables (src/messages): each code words itself and links its page, and each
 * page reads as plain sentences (the docs' `/e` pages render it).
 */
import { describe, expect, it } from 'vitest';
import { DEVTOOLS_ERRORS, DEVTOOLS_WARNINGS, line } from '../src/messages/runtime.ts';
import { DEVTOOLS_BUILD_ERRORS, DEVTOOLS_BUILD_WARNINGS } from '../src/messages/build.ts';

const TABLES = {
	...DEVTOOLS_ERRORS,
	...DEVTOOLS_WARNINGS,
	...DEVTOOLS_BUILD_ERRORS,
	...DEVTOOLS_BUILD_WARNINGS
};

describe('the devtools messages', () => {
	it("the dock's failed download: its wording, then its page", () => {
		const [wording, link] = line('devtools_dock_load_failed').split('\n');
		expect(wording).toBe(
			'[ogygia] the devtools dock’s code failed to load (click its button to try again):'
		);
		expect(link).toBe('https://ogygiajs.dev/e/devtools_dock_load_failed');
	});

	it("each code's page reads as plain sentences: no { } or < outside backticks", () => {
		const bad = Object.entries(TABLES)
			.filter(([, m]) => /[{}<]/.test(m.details().replace(/`[^`]*`/g, '')))
			.map(([c]) => c);
		expect(bad).toEqual([]);
	});
});
