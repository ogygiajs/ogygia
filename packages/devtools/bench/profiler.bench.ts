// The profiler's Node-side analysis, run per profiled request or per report: folding a CPU profile
// into the report's functions, lines and categories; decoding a server bundle's source map; the
// load-function source scans behind the "same work every request" and data-key findings; and the
// document diff between two renders.
//
// The devtools dock and the profiler's report UI run in the browser and wait for Abax's browser
// coverage.
import { bench } from '@bench/abax/bench';
import { analyze, decode_mappings, type CpuProfile } from '../src/profiler/analyze.ts';
import { doc_diff } from '../src/profiler/doc-diff.ts';
import { constant_work, key_sources } from '../src/profiler/source-scan.ts';

const APP = 'file:///srv/app/build/server/chunks';
const SVELTE = 'file:///srv/app/node_modules/svelte/src/internal/server';

/** A server render's CPU profile: a request handle over components, app code and dependencies. */
function render_profile(components: number, samples: number): CpuProfile {
	const nodes: CpuProfile['nodes'] = [];
	const frame = (functionName: string, url: string, lineNumber: number) => ({
		functionName,
		url,
		lineNumber,
		columnNumber: 4,
		scriptId: String(1 + (lineNumber % 40))
	});
	nodes.push({ id: 1, callFrame: frame('(root)', '', 0), children: [2, 3] });
	nodes.push({ id: 3, callFrame: frame('(garbage collector)', '', 0) });
	nodes.push({ id: 2, callFrame: frame('handle', `${APP}/hooks.server.js`, 12), children: [] });
	const leaves: number[] = [3];
	let id = 4;
	for (let c = 0; c < components; c++) {
		const comp = id++;
		nodes[2].children!.push(comp);
		const kids: number[] = [];
		nodes.push({
			id: comp,
			callFrame: frame(`Block${c % 40}`, `${APP}/Block${c % 40}.js`, 20 + c),
			children: kids
		});
		for (let k = 0; k < 4; k++) {
			const child = id++;
			kids.push(child);
			const url =
				k === 0
					? `${SVELTE}/index.js`
					: k === 1
						? `${APP}/format.js`
						: `file:///srv/app/node_modules/devalue/src/stringify.js`;
			nodes.push({
				id: child,
				callFrame: frame(
					k === 0 ? 'escape_html' : k === 1 ? `format_${c % 9}` : 'stringify',
					url,
					5 + k * 30
				),
				hitCount: 0,
				positionTicks: [{ line: 6 + k * 30, ticks: 3 }]
			});
			leaves.push(child);
		}
	}
	const sample_ids: number[] = [];
	const deltas: number[] = [];
	for (let s = 0; s < samples; s++) {
		sample_ids.push(leaves[(s * 7919) % leaves.length]);
		deltas.push(100 + (s % 7) * 10);
	}
	return { nodes, startTime: 0, endTime: samples * 130, samples: sample_ids, timeDeltas: deltas };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(n: number): string {
	let v = n < 0 ? (-n << 1) | 1 : n << 1;
	let out = '';
	do {
		let digit = v & 31;
		v >>>= 5;
		if (v > 0) digit |= 32;
		out += B64[digit];
	} while (v > 0);
	return out;
}

/** The `mappings` of a bundled server chunk: `lines` lines of ~10 segments over 30 sources. */
function mappings(lines: number): string {
	const out: string[] = [];
	for (let l = 0; l < lines; l++) {
		const segs: string[] = [];
		for (let s = 0; s < 10; s++) {
			segs.push(
				vlq(s === 0 ? 0 : 6) +
					vlq(s === 0 && l % 25 === 0 ? 1 : 0) +
					vlq(s === 0 ? 1 : 0) +
					vlq(s === 0 ? -54 : 6)
			);
		}
		out.push(segs.join(','));
	}
	return out.join(';');
}

/** A `+page.server.ts` with a load that does the same work every request, and data keys. */
function load_module(consts: number): string {
	const lines = [
		`import type { PageServerLoad } from './$types';`,
		`import { PRODUCTS, BRANDS, validateAll, attachBrands } from '$lib/catalog';`,
		'',
		'export const load: PageServerLoad = async ({ url, fetch, locals }) => {',
		'\tconst origin = url.origin;'
	];
	for (let i = 0; i < consts; i++) {
		lines.push(
			i % 3 === 0
				? `\tconst valid${i} = validateAll(PRODUCTS.slice(${i}));`
				: i % 3 === 1
					? `\tconst joined${i} = attachBrands(valid${i - 1}, BRANDS);`
					: `\tconst user${i} = await (await fetch(origin + '/api/user/${i}')).json();`
		);
	}
	const keys = Array.from(
		{ length: consts },
		(_, i) => `\t\tkey${i}: ${i % 3 === 2 ? `user${i}` : `joined${i - (i % 3 === 0 ? -1 : 0)}`},`
	);
	lines.push('\treturn {', ...keys, '\t\tlocale: locals.locale', '\t};', '};');
	return lines.join('\n') + '\n';
}

function render_html(rows: number, changed: number): string {
	let out = '<!doctype html><html><head><title>t</title></head><body>';
	for (let i = 0; i < rows; i++) {
		const v = i < changed ? `v2-${i}` : `v1-${i}`;
		out += `<ogygia-region entry="/_app/ogygia/og-region.${i % 20}.js" data-og-fp="fp${i}"><li data-v="${v}">Row ${i} ${v}</li></ogygia-region>`;
		out += `<script type="application/ogygia-props" data-ogygia-props="fp${i}">{"row":${i},"v":"${v}"}</script>`;
	}
	return out + '</body></html>';
}

bench(
	'analyze: fold a render’s CPU profile into the report',
	({ profile }) => analyze(profile).functions.length,
	{
		setup: () => ({ profile: render_profile(60, 4000) }),
		scale: (_ctx, k) => ({ profile: render_profile(60 * k, 4000 * k) })
	}
);

bench('decode_mappings: a server chunk’s source map', ({ m }) => decode_mappings(m).length, {
	setup: () => ({ m: mappings(2000) }),
	scale: (_ctx, k) => ({ m: mappings(2000 * k) })
});

bench(
	'source scans: constant work and data keys of a load function',
	({ source }) => constant_work(source).length + (key_sources(source)?.size ?? 0),
	{ setup: () => ({ source: load_module(60) }) }
);

bench(
	'doc_diff: two renders of a page that differ in a few rows',
	({ a, b }) => doc_diff(a, b)?.groups.length ?? 0,
	{ setup: () => ({ a: render_html(400, 0), b: render_html(400, 12) }) }
);
