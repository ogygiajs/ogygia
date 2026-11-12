import type { PreprocessorGroup } from 'svelte/compiler';
import { ogygiaPreprocess, type MarkdownOptions } from './index.ts';
import { component_tag_in, try_region_emit } from './region-emit.ts';
import { OgygiaError } from '../messages/build.ts';

const groups = new WeakMap<object, PreprocessorGroup>();
let null_group: PreprocessorGroup | null = null;

function group_for(options: MarkdownOptions | null | undefined): PreprocessorGroup {
	const build = () => ogygiaPreprocess({ ...options, region: false }) as PreprocessorGroup;
	if (!options) return (null_group ??= build());
	let g = groups.get(options as object);
	if (!g) groups.set(options as object, (g = build()));
	return g;
}

/** The engine behind `import.meta.og.md(text)`: renders `text` (Markdown) to static HTML through the
 *  app's own markdown preprocessor, so it renders as a `.md` document would. Content that compiles
 *  to something dynamic (a `<script>`, an island import) throws `content_md_dynamic`. */
export async function render_markdown(
	options: MarkdownOptions | null | undefined,
	text: string
): Promise<string> {
	const group = group_for(options);
	const out = (await group.markup?.({ content: text, filename: 'og-md-snippet.md' })) as
		| { code?: string }
		| undefined;
	const code = out?.code ?? text;
	const emitted = component_tag_in(code) === null ? try_region_emit(code, []) : null;
	if (!emitted) {
		throw new OgygiaError('content_md_dynamic');
	}
	return emitted.html;
}
