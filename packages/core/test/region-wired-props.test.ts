import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import { __register_transportable, wire } from '../src/live-transport.ts';
import { set_region_endpoints } from './_stubs/server.region-endpoint.ts';
import type { RegionSettings } from '../src/region-plan.ts';

class Badge {
	label: string;
	constructor(label = '') {
		this.label = label;
	}
	static [wire] = {
		encode: (b: Badge) => b.label,
		decode: (label: string) => new Badge(label)
	};
}
__register_transportable('src/lib/badge.ts#Badge', Badge);

type Props = Record<string, unknown>;
const under = RegionUnder as unknown as Component<{ regions: Props[] }>;
const tiny = Tiny as unknown as Component;
const PROPS_SCRIPT_RE = /<script type="application\/ogygia-props"[^>]*>/g;

afterEach(() => set_region_endpoints(null));

function props_scripts(region: Props): string[] {
	return render(under, { props: { regions: [region] } }).body.match(PROPS_SCRIPT_RE) ?? [];
}

describe('props that carry a transportable instance', () => {
	it("an island off Kit's page pass names the class's module on the props script beside it", () => {
		const island: RegionSettings = { mode: 'island', entry: '/islands/tiny.js', component: tiny };
		const scripts = props_scripts({ __og: island, __props: { who: new Badge('ada') } });
		expect(scripts).toHaveLength(1);
		expect(scripts[0]).toContain('data-og-wire="src/lib/badge.ts"');
	});

	it("a hole that wakes names the class's module on the props script beside it", () => {
		set_region_endpoints({ mint_server_region: (entry) => `/__ogygia__?id=${entry}` });
		const hole: RegionSettings = {
			mode: 'server',
			entry: 'hole-a',
			component: tiny,
			wake: 'load',
			module: '/islands/hole.js'
		};
		const scripts = props_scripts({ __og: hole, __props: { who: new Badge('ada') } });
		expect(scripts).toHaveLength(1);
		expect(scripts[0]).toContain('data-og-wire="src/lib/badge.ts"');
	});
});
