import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setContext, type Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import Echo from './_fixtures/Echo.svelte';
import Wrap from './_fixtures/Wrap.svelte';
import { REGION_BRAND } from '../src/region.ts';
import { HOLE_SLOT_SEQUENCE, hole_slot_sequence } from '../src/region-snippet.ts';
import type { RegionSettings } from '../src/region-plan.ts';

type Props = Record<string, unknown>;
type Renderer = { push(html: string): void };
const under = RegionUnder as unknown as Component<{ setup?: () => void; regions: Props[] }>;
const MODULE = '/islands/dual.js';
const SLOT_ID_RE = /data-og-slot="([^"]+)"/;

const static_dual = (props: Props) => ({
	[REGION_BRAND]: true,
	kind: 'dual',
	component: Echo,
	props,
	id: 'dual-a',
	module: MODULE,
	sign: () => '/signed'
});

const island_with_children: Props = {
	__og: {
		mode: 'island',
		entry: MODULE,
		component: Wrap as unknown as Component
	} satisfies RegionSettings,
	__props: {},
	children: (r: Renderer) => r.push('<i>kid</i>')
};

function body(regions: Props[], setup?: () => void): string {
	return render(under, { props: { regions, setup } }).body;
}

describe('a held static dual', () => {
	it('hands its props to its component', () => {
		const html = body([{ of: static_dual({ text: 'from the dual' }) }]);
		expect(html).toContain('<i data-echo="">from the dual</i>');
	});

	it('leaves the slot id of a later island of the same module as it is without the dual', () => {
		const in_hole = () => setContext(HOLE_SLOT_SEQUENCE, hole_slot_sequence('abcdef0123'));
		const alone = SLOT_ID_RE.exec(body([island_with_children], in_hole))?.[1];
		const after_dual = SLOT_ID_RE.exec(
			body([{ of: static_dual({ text: 'x' }) }, island_with_children], in_hole)
		)?.[1];
		expect(alone).toBeTruthy();
		expect(after_dual).toBe(alone);
	});
});
