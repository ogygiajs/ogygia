import { expect, test } from 'vitest';
import { analyze_page } from '../src/page-insights.ts';

test('the finding groups them and names the island when it knows it', () => {
	const r = analyze_page(
		{
			vitals: {},
			visit: {
				warnings: [
					{
						code: 'hydration_html_changed',
						message: 'x',
						file: '/a/Card.svelte',
						fp: 'aaaaaaaa11111111'
					},
					{
						code: 'hydration_html_changed',
						message: 'x',
						file: '/a/Card.svelte',
						fp: 'aaaaaaaa11111111'
					}
				]
			},
			islands: [],
			firsts: [],
			shifts: [],
			longtasks: []
		},
		[{ fp: 'aaaaaaaa11111111', name: 'Card', kind: 'island', wake: 'load', hydrated: true }]
	);
	const f = r.findings.find((x) => x.code === 'svelte-hydration-warning')!;
	expect(f.message).toContain('hydration_html_changed in Card.svelte (Card) ×2');
	expect(f.fps).toEqual(['aaaaaaaa11111111']);
});
