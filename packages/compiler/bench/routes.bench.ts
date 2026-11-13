// Kit's route answers (src/compiler/kit.ts over src/compiler/queries.ts): each host's csr world asked
// the way every transform asks it, the app-wide answers the virtual modules bake, and a dev session's
// file events (an edit that changes nothing, a csr flip, a page added) with the answers asked again.
import { bench } from '@bench/heisenbench/bench';
import { dedent } from '@ogygia/core/contract';
import { memory_fs, type MemoryFs } from '../src/compiler/fs.ts';
import {
	clientBuildWillSkip,
	csrTrueRouteIds,
	errorCsrTrueRouteIds,
	hasAnyCsrFalseRoute,
	hasAnyCsrTrueRoute,
	page_route_config,
	routeCsrIsFalse,
	routeCsrIsTrue,
	route_reader,
	type Routes
} from '../src/compiler/kit.ts';

const ROUTES = '/app/src/routes';
const KEYS = ['tier'];

/** A route tree: a csr=false root, a group, a csr=true shop, twenty docs pages. */
function app(): MemoryFs {
	const files: Record<string, string> = {
		[`${ROUTES}/+layout.ts`]: 'export const csr = false;\n',
		[`${ROUTES}/+layout.svelte`]: '<slot />\n',
		[`${ROUTES}/+page.svelte`]: '<h1>home</h1>\n',
		[`${ROUTES}/(shop)/+layout.svelte`]: '<slot />\n',
		[`${ROUTES}/(shop)/cart/+page.ts`]: dedent`
			export const csr = true;
			export const config = { tier: 'gold' };
		`,
		[`${ROUTES}/(shop)/cart/+page.svelte`]: '<h1>cart</h1>\n'
	};
	for (let i = 0; i < 20; i++) {
		files[`${ROUTES}/docs/p${i}/+page.svelte`] = `<h1>${i}</h1>\n`;
		if (i % 4 === 0)
			files[`${ROUTES}/docs/p${i}/+page.server.ts`] = 'export const load = () => ({});\n';
	}
	return memory_fs(files);
}

/** Every answer: each host's world (as a transform asks it), then the app-wide ones. */
function ask(r: Routes, fs: MemoryFs): number {
	let n = 0;
	for (const f of fs.files()) {
		if (!f.endsWith('.svelte')) continue;
		if (routeCsrIsFalse(r, f, ROUTES)) n++;
		if (routeCsrIsTrue(r, f, ROUTES)) n++;
	}
	n += csrTrueRouteIds(r, ROUTES).length + errorCsrTrueRouteIds(r, ROUTES).length;
	n += Object.keys(page_route_config(r, ROUTES, KEYS)).length;
	if (hasAnyCsrTrueRoute(r, ROUTES)) n++;
	if (hasAnyCsrFalseRoute(r, ROUTES)) n++;
	if (clientBuildWillSkip(r, ROUTES)) n++;
	return n;
}

bench('route answers: every host and the app-wide answers, read cold then from memory', () => {
	const fs = app();
	const r = route_reader(fs);
	return ask(r, fs) + ask(r, fs);
});

bench('route answers: dev file events, each followed by every answer again', () => {
	const fs = app();
	const r = route_reader(fs);
	let n = ask(r, fs);
	const edit = (abs: string, text: string | null, event: 'create' | 'update' | 'delete') => {
		fs.set(abs, text);
		if (r.touch(abs, event)) n++;
		n += ask(r, fs);
	};
	edit(`${ROUTES}/docs/p3/+page.svelte`, '<h1>three</h1>\n', 'update');
	edit(
		`${ROUTES}/+layout.ts`,
		dedent`
			// root
			export const csr = false;
		`,
		'update'
	);
	edit(`${ROUTES}/docs/+layout.ts`, 'export const csr = true;\n', 'create');
	edit(`${ROUTES}/docs/new/+page.svelte`, '<h1>new</h1>\n', 'create');
	edit(`${ROUTES}/docs/+layout.ts`, null, 'delete');
	return n;
});
