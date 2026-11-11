/**
 * The job module: one region's server render, by name, from props that crossed by structured clone.
 * The server imports it `with { run: 'worker' }`; this file does not know where it runs.
 * It is `async` so its type is the same on both sides of the thread (the doc's "async-only" rule).
 */
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import Table from './regions/Table.svelte';
import Code from './regions/Code.svelte';

const REGIONS: Record<string, Component<never>> = {
	table: Table as Component<never>,
	code: Code as Component<never>
};

export async function render_region(name: string, props: Record<string, unknown>): Promise<string> {
	const component = REGIONS[name];
	if (component === undefined) throw new Error('no region named ' + name);
	const out = render(component as Component<Record<string, unknown>>, { props });
	return '<ogygia-region data-lab="' + name + '">' + out.body + '</ogygia-region>';
}
