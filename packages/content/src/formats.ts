import type { Component } from 'svelte';
import type { Heading, LinkRef } from './index.ts';
import { region } from '@ogygia/core';
import { prebaked_region } from '@ogygia/core/internal';
import { OgygiaError } from './messages/runtime.ts';
import {
	defineSource,
	toRawSource,
	type Format,
	type GlobMap,
	type RawSource,
	type Source
} from './source.ts';

type Input<V> = GlobMap | RawSource<V>;
export type BuilderOpts = { id?: (key: string) => string };

function unwrap_default(resolved: unknown): unknown {
	if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) return resolved;
	const mod = resolved as Record<string, unknown>;
	if (!('default' in mod)) return resolved;
	const keys = Object.keys(mod).filter((k) => k !== '__esModule');
	if (keys.length === 1 && keys[0] === 'default') return mod.default;
	return resolved;
}

function as_object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OgygiaError('content_format_not_object', {
			label,
			got: Array.isArray(value) ? 'array' : typeof value
		});
	}
	return value as Record<string, unknown>;
}

/** Meta the markdown source derives: h2–h4 headings (for a TOC) and every markdown link (for the
 *  ogygia link audit), both collected during compile. */
export type MarkdownMeta = { headings: Heading[]; links: LinkRef[] };

const markdown_format: Format<unknown, MarkdownMeta> = (resolved, id) => {
	if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
		throw new OgygiaError('content_markdown_not_module', { id });
	}
	const mod = resolved as Record<string, unknown>;
	if (!('metadata' in mod)) {
		throw new OgygiaError('content_markdown_no_metadata', { id });
	}
	const meta = as_object(mod.metadata ?? {}, `markdown:${id}`);
	const { headings, links, ...data } = meta as { headings?: Heading[]; links?: LinkRef[] } & Record<
		string,
		unknown
	>;
	const source =
		typeof mod.__ogygia_source === 'function'
			? (mod.__ogygia_source as () => Promise<string>)
			: undefined;
	const baked = (mod.__ogygia_region as { html?: string } | undefined)?.html;
	const css_id = typeof mod.__ogygia_css === 'string' ? mod.__ogygia_css : undefined;
	return {
		data,
		...(mod.default !== undefined
			? {
					body:
						typeof baked === 'string'
							? prebaked_region(mod.default as Component<Record<string, never>>, baked, css_id)
							: region(mod.default as Component<Record<string, never>>, {}, undefined, css_id)
				}
			: {}),
		...(source ? { source } : {}),
		meta: {
			headings: Array.isArray(headings) ? headings : [],
			links: Array.isArray(links) ? links : []
		}
	};
};

/**
 * `.svx` / `.md` content compiled by the markdown pipeline: `data` is the frontmatter, `meta` the
 * headings and links, `body` the page as a region. A page the region emitter baked to HTML renders
 * that HTML with no Svelte render; a page with its own `<style>` carries its CSS key on the body, so
 * the page links that stylesheet. The preprocessor's raw-text import becomes the entry's lazy
 * `source`.
 */
export function markdown(input: Input<unknown>, opts: BuilderOpts = {}): Source<MarkdownMeta> {
	return defineSource(toRawSource(input, opts), markdown_format);
}

const json_format: Format<unknown> = (resolved, id) => ({
	data: as_object(unwrap_default(resolved), `json:${id}`)
});

/** JSON modules — a plain object, or `{ default: object }`. Data-only (no body). */
export function json(input: Input<unknown>, opts: BuilderOpts = {}): Source {
	return defineSource(toRawSource(input, opts), json_format);
}
