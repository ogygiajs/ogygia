/**
 * Checks every internal link of the BUILT site: each `href` that points into the site must name a
 * built page (or file), and each `#anchor` must name an `id` on that page. The per-page `links()`
 * check already guards the markdown bodies at prerender; this covers everything else the pages
 * render (the shell, the section switcher, the homepage, generated API pages). Run after a build:
 *
 *   pnpm --filter docs build && pnpm --filter docs check:links
 *
 * Exits with 1 and lists each broken link (page, href, reason) when anything is broken.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../.vercel/output/static');
const HREF_RE = /\shref="([^"]*)"/g;
const ID_RE = /\sid="([^"]*)"/g;
const ENTITY_RE = /&(amp|quot|#39|lt|gt);/g;
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>' };

if (!existsSync(ROOT)) {
	console.error(`[check-links] no build at ${ROOT}; run \`pnpm --filter docs build\` first.`);
	process.exit(2);
}

/** Every file under the output, as site paths (`/docs/start/overview.html`). */
function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const abs = path.join(dir, name);
		if (statSync(abs).isDirectory()) walk(abs, out);
		else out.push('/' + path.relative(ROOT, abs).split(path.sep).join('/'));
	}
	return out;
}

const files = new Set(walk(ROOT));
const unescape = (s: string) => s.replace(ENTITY_RE, (_, e: string) => ENTITIES[e] ?? _);

/** The routes the adapter serves from a function rather than a file (the homepage, the search
 *  page): every `dest` route after the filesystem step, minus the 404 catch-all. */
type VercelRoute = { src?: string; dest?: string; handle?: string };
const config = JSON.parse(readFileSync(path.join(ROOT, '../config.json'), 'utf8')) as {
	routes: VercelRoute[];
};
const after = config.routes.slice(config.routes.findIndex((r) => r.handle === 'filesystem') + 1);
const dynamic = after
	.filter((r) => r.src && r.dest && r.src !== '/.*')
	.map((r) => new RegExp(r.src!));

/** The built file a site path is served from (`/docs/x` → `/docs/x.html`), `'dynamic'` for a route
 *  a function answers, or null. */
function resolveFile(p: string): string | null {
	const clean = decodeURI(p.replace(/\/+$/, '')) || '/';
	for (const candidate of [
		clean,
		`${clean}.html`,
		`${clean}/index.html`,
		clean === '/' ? '/index.html' : ''
	]) {
		if (candidate && files.has(candidate)) return candidate;
	}
	return dynamic.some((rx) => rx.test(clean)) ? 'dynamic' : null;
}

const ids = new Map<string, Set<string>>();
function idsOf(file: string): Set<string> {
	let set = ids.get(file);
	if (!set) {
		set = new Set(
			[...readFileSync(path.join(ROOT, file), 'utf8').matchAll(ID_RE)].map((m) => unescape(m[1]))
		);
		ids.set(file, set);
	}
	return set;
}

const pages = [...files].filter((f) => f.endsWith('.html'));
const broken: string[] = [];
let checked = 0;

for (const page of pages) {
	const html = readFileSync(path.join(ROOT, page), 'utf8');
	const pagePath = page.replace(/(\/index)?\.html$/, '') || '/';
	for (const m of html.matchAll(HREF_RE)) {
		const href = unescape(m[1]);
		if (!href || /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(href)) continue;
		checked++;
		const url = new URL(href, `http://site${pagePath}`);
		const target =
			url.pathname === pagePath && href.startsWith('#') ? page : resolveFile(url.pathname);
		if (!target) {
			broken.push(`${pagePath}  ${href}  (no such page)`);
			continue;
		}
		const hash = decodeURIComponent(url.hash.slice(1));
		if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) {
			broken.push(`${pagePath}  ${href}  (no #${hash} on ${target})`);
		}
	}
}

console.log(`[check-links] ${pages.length} pages, ${checked} internal links checked.`);
if (broken.length) {
	console.error(`[check-links] ${broken.length} broken:\n  ${broken.join('\n  ')}`);
	process.exit(1);
}
console.log('[check-links] no broken links.');
