import { configure_shiki, fence_config_key, render_code_region } from './shiki.ts';
import { default_pipeline, type CodePipeline } from './code-render.ts';
import type { MarkdownOptions } from './index.ts';
import type { SerializedRegion } from '../region-store.ts';

function code_env(options: MarkdownOptions | null | undefined) {
	const { code, ...shiki_opts } = options ?? {};
	const cfg = configure_shiki({
		...shiki_opts,
		...(code?.transformers ? { transformers: code.transformers } : {})
	});
	const pipe: CodePipeline = {
		meta: code?.meta ?? default_pipeline().meta,
		variants: code?.variants ?? []
	};
	return { cfg, pipe, config_key: fence_config_key(cfg, pipe, code?.cacheSalt ?? '') };
}

/**
 * The engine behind `import.meta.og.code(source, lang, meta?)`: renders a `lang` snippet (with an
 * optional `meta` infostring) to a {@link SerializedRegion} through the same fence path a markdown
 * code block takes (the app's Shiki config, meta parsers, variant generators, the fence cache). The
 * html matches the same fence in a document, except that a document fence also carries a code id.
 */
export async function render_snippet(
	options: MarkdownOptions | null | undefined,
	source: string,
	lang: string,
	meta?: string
): Promise<SerializedRegion> {
	const { cfg, pipe, config_key } = code_env(options);
	return render_code_region(cfg, pipe, config_key, source, lang, meta ?? '');
}
