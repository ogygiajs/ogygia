/**
 * A LAKE'S IDENTITY (`data-og-lake`, #1554): the fingerprint of its entry and props, so two lakes of
 * one component with different props get two keys in the runtime's lake cache. Region computes it on
 * both legs, so it is a pure function of the entry and the props.
 */
import { describe, expect, it } from 'vitest';
import { hole_identity, lake_identity } from '../src/server/props-wire.ts';

const ENTRY = 'lake-entry-1';

describe('lake identity', () => {
	it('two lakes of one component with different props have different identities', () => {
		expect(lake_identity(ENTRY, { tag: 'header' })).not.toBe(
			lake_identity(ENTRY, { tag: 'footer' })
		);
	});

	it('the same entry and props give the same identity every time (both legs agree)', () => {
		expect(lake_identity(ENTRY, { tag: 'header', n: 2 })).toBe(
			lake_identity(ENTRY, { tag: 'header', n: 2 })
		);
	});

	it('is a hole identity over the props: one identity model for holes and lakes', () => {
		expect(lake_identity(ENTRY, { tag: 'header' })).toBe(hole_identity(ENTRY, { tag: 'header' }));
	});

	it('leaves function props out (children, snippets, callbacks), and never calls them', () => {
		let called = 0;
		const children = () => void called++;
		const onpick = () => void called++;
		expect(lake_identity(ENTRY, { tag: 'header', children, onpick })).toBe(
			lake_identity(ENTRY, { tag: 'header' })
		);
		expect(called).toBe(0);
	});

	it('props no wire carries give no identity, so the lake is known by its entry and place', () => {
		class Unwired {
			n = 1;
		}
		expect(lake_identity(ENTRY, { model: new Unwired() })).toBe('');
	});

	it('no entry gives no identity', () => {
		expect(lake_identity('', { tag: 'header' })).toBe('');
	});
});
