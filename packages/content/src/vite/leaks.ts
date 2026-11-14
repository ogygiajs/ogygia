/**
 * Guardrail: a content collection must never reach a CLIENT chunk. Ground truth is the finished
 * bundle. A compiled corpus module (.svx/.md) in a client chunk means a `content()` collection was
 * imported into client-shipped code (usually an island), which drags its eager `import.meta.glob` —
 * every doc — into the browser. On a csr=false site the corpus renders server-side and should never
 * appear here, so any hit is a real leak. A warning, not a throw: the guardrail must never break a build.
 */
import path from 'node:path';
import type { Plugin as VitePlugin } from 'vite';
import { is_island_path } from '@ogygia/compiler';
import { warn } from '../messages/build.ts';

const CORPUS_RE = /\.(svx|md)(\?|$)/;
/** A `?…type=style…` / `lang.css` sub-import id — a CSS face, never a corpus JS leak. */
const CONTENT_STYLE_QUERY_RE = /[?&](?:type=style|lang\.css)/;

interface Leg {
	environment?: { name?: string; config?: { consumer?: string } };
}

export function content_leaks(): VitePlugin {
	let root = '';
	let is_build = false;
	let is_ssr = false;
	return {
		name: 'ogygia:content-leaks',
		configResolved(config) {
			root = config.root;
			is_build = config.command === 'build';
			is_ssr = !!config.build?.ssr;
		},
		// `writeBundle`, not `generateBundle`: the bundler still merges shared chunks after generate
		writeBundle(_options, bundle) {
			const env = (this as Leg | null)?.environment;
			const server_leg = env ? env.name === 'ssr' || env.config?.consumer === 'server' : is_ssr;
			if (!is_build || server_leg) return;
			warn_content_leaks(bundle as Record<string, unknown>, root);
		}
	};
}

function warn_content_leaks(bundle: Record<string, unknown>, root: string): void {
	try {
		const leaks: Array<{ chunk: string; modules: string[] }> = [];
		for (const [key, chunk] of Object.entries(bundle)) {
			if ((chunk as { type?: string }).type !== 'chunk') continue;
			const ids: string[] =
				(chunk as { moduleIds?: string[] }).moduleIds ??
				Object.keys((chunk as { modules?: Record<string, unknown> }).modules ?? {});
			// A `?…type=style…`/`lang.css` sub-import is the content module's CSS FACE, emitted on
			// purpose (see the client-leg content-CSS emit) — it carries no corpus JS, so it is not
			// a leak. Only a real corpus JS module counts.
			const corpus = ids.filter(
				(id) => CORPUS_RE.test(id) && !is_island_path(id) && !CONTENT_STYLE_QUERY_RE.test(id)
			);
			if (corpus.length)
				leaks.push({ chunk: (chunk as { fileName?: string }).fileName ?? key, modules: corpus });
		}
		if (leaks.length) {
			const all = [...new Set(leaks.flatMap((l) => l.modules))];
			warn('content_leaked_to_client', {
				count: all.length,
				chunk: leaks[0].chunk,
				// the first five, one a line
				modules: all
					.slice(0, 5)
					.map((m) => path.relative(root, m.split('?')[0]))
					.join('\n')
			});
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- a guardrail never breaks the build; the check is skipped
	} catch {}
}
