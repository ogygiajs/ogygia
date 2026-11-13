/**
 * Where an app's import specifier points, as the bundler resolves it, without the bundler: the one
 * rule for the region identity (a component imported any way is one region:
 * test/region-identity-canonical.test.ts) and for the CSS walks (fouc, router CSS, the island
 * closure).
 */
import fs from 'node:fs';
import path from 'node:path';

/** An app alias, as Vite's `resolve.alias` lists it (Kit's `$lib` and `kit.alias` among them). */
export interface AppAlias {
	find: string | RegExp;
	replacement: string;
}

export interface AppSpecCtx {
	readonly root: string;
	readonly libDir: string;
	readonly alias?: readonly AppAlias[];
}

/**
 * The absolute path `spec` names from `importer` (a file path, possibly without its extension):
 * `$lib/…`, a relative path, a root-absolute `/…` (under the app root when its first directory is
 * there, as Vite tries it; else the file-system path), or an app alias. Null: a package specifier.
 */
export function resolve_app_spec(spec: string, importer: string, ctx: AppSpecCtx): string | null {
	if (spec === '$lib' || spec.startsWith('$lib/')) {
		return path.join(ctx.libDir, spec === '$lib' ? '' : spec.slice('$lib/'.length));
	}
	if (spec.startsWith('.')) return path.resolve(path.dirname(importer), spec);
	if (spec.startsWith('/')) {
		if (spec.startsWith(`${ctx.root}/`) || !ctx.root) return path.normalize(spec);
		const top = spec.slice(1).split('/')[0];
		return top && fs.existsSync(path.join(ctx.root, top))
			? path.join(ctx.root, spec)
			: path.normalize(spec);
	}
	for (const a of ctx.alias ?? []) {
		if (typeof a.find === 'string') {
			if (spec === a.find) return a.replacement;
			if (spec.startsWith(`${a.find}/`)) return a.replacement + spec.slice(a.find.length);
		} else if (a.find.test(spec)) {
			return spec.replace(a.find, a.replacement);
		}
	}
	return null;
}
