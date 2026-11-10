/**
 * Pages upstream moved: an old address resolves to the page that holds its content now, as
 * svelte.dev redirects it, so a link the corpus still carries (a type's doc comment) is not dead.
 */
import { describe, expect, it } from 'vitest';
import { moved_leaf } from '../src/lib/moved-pages.ts';

describe('moved pages', () => {
	it('Kit 3 moved the configuration page into the Vite plugin reference', () => {
		expect(moved_leaf('kit', 'configuration')).toBe('@sveltejs-kit-vite');
	});

	it('a move belongs to its own topic', () => {
		expect(moved_leaf('svelte', 'configuration')).toBeNull();
		expect(moved_leaf('kit', 'routing')).toBeNull();
	});
});
