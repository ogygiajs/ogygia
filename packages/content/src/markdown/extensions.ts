/**
 * Markdown extensions: what another Vite plugin adds to content's markdown pipeline without either
 * package importing the other. A plugin offers one on its Vite plugin object as
 * `api.ogygiaMarkdown`; `content()` reads the resolved plugin list and holds each offer in the
 * bridge, owned by that config, so a config that stops listing the plugin (or offers nothing) drops
 * it, and the preprocessor reads the live set on every compile.
 *
 * @packageDocumentation
 */
import type {
	MARKDOWN_EXTENSION_API,
	MarkdownExtension as Offered,
	MarkdownFinish
} from '@ogygia/compiler/vite';
import { scope } from '@ogygia/machine';
import { bridge } from '../bridge.ts';
import { OgygiaError } from '../messages/build.ts';
import type { StagedPlugin } from './index.ts';

export type { MarkdownFinish };

/** A markdown extension another plugin offers (compiler's contract, with content's rehype entry). */
export type MarkdownExtension = Offered<StagedPlugin>;

/** The Vite plugin `api` key an extension is offered under. */
export const EXTENSION_API: typeof MARKDOWN_EXTENSION_API = 'ogygiaMarkdown';

function is_extension(value: unknown): value is MarkdownExtension {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.name === 'string' &&
		typeof v.cache_key === 'function' &&
		(v.rehype === undefined || Array.isArray(v.rehype)) &&
		(v.finish === undefined || typeof v.finish === 'function')
	);
}

/** Hold the extensions `plugins` offer, under a new lifetime that ends the previous config's. */
export function hold_markdown_extensions(
	plugins: readonly { name?: string; api?: unknown }[]
): void {
	bridge.markdownExtensionsScope?.close();
	const life = (bridge.markdownExtensionsScope = scope());
	for (const p of plugins) {
		const offer = (p.api as Record<string, unknown> | undefined)?.[EXTENSION_API];
		if (offer === undefined) continue;
		if (!is_extension(offer))
			throw new OgygiaError('content_markdown_extension_invalid', { plugin: p.name ?? '?' });
		bridge.markdownExtensions.set(offer.name, offer, life);
	}
}

/** The extensions held now, in the order they were set. */
export function markdown_extensions(): MarkdownExtension[] {
	return [...bridge.markdownExtensions.values()];
}
