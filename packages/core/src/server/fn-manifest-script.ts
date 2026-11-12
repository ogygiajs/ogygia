import { OGYGIA_FNM } from '../wire-markup.ts';

/** The one executing inline script that registers a build's `og.$` factories (tag → factory source)
 *  before any island hydrates: the fn kind resolves against `globalThis.__OG_FNM` with no eval. */
export function fn_manifest_script(manifest: Record<string, string>): string {
	const entries = Object.entries(manifest)
		.map(([tag, src]) => `${JSON.stringify(tag)}:(${src})`)
		.join(',');
	return `<script ${OGYGIA_FNM}>globalThis.__OG_FNM=Object.assign(globalThis.__OG_FNM||{},{${entries}});</script>`;
}
