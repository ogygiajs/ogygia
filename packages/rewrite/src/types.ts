import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { MatchSpec } from './scan.ts';

/** `'document'`: a page render. `'region'`: a region answer (a hole, a lake remount). */
export type RewriteKind = 'document' | 'region';

/** What ogygia knows about the HTML being rewritten. */
export interface RewriteContext {
	/** `'document'`: a page render. `'region'`: a region answer (a hole, a lake remount). */
	kind: RewriteKind;
	/** Kit hydrates the whole page. Always `false` for a region answer. */
	csr: boolean;
	/** The URL of the request being answered. */
	url: URL;
	/** The request being answered. */
	event: RequestEvent;
	/** Fires when the request is cancelled (the visitor left): stop the render, nothing reads it. */
	signal: AbortSignal;
}

/** One outermost element `match` picked, as `render` gets it. */
export interface RewriteElement {
	/** The tag name, lower-case. */
	readonly name: string;
	/** Its outer HTML. ogygia's marks inside are numbered from 0, so the same element has the same
	 *  bytes on every page: a cache can key on `html`. */
	readonly html: string;
	/** ogygia puts this element back for Svelte before anything hydrates (it carries `og-h`): render
	 *  its plan (its children inside `<slot>` wrappers, `og-shadow`, optionally `og-keep`). When
	 *  `false`, render it any way you like. */
	readonly restored: boolean;
}

/** A sheet a render needs, sent once per key per response. */
export interface RewriteSheet {
	key: string;
	css: string;
	/** `'page'`: a `<style>` for the document. `'shadow'`: a sheet a restored host names in
	 *  `og-shadow`. */
	scope: 'page' | 'shadow';
}

/** One element's render: its HTML and the sheets it needs. A string is shorthand for `{ html }`. */
export type RewriteResult = string | { html: string; sheets?: readonly RewriteSheet[] };

/** A rewrite of the elements `match` picks. */
export interface ElementRewrite {
	/** Which elements go to `render`: every custom element whose name starts with this prefix,
	 *  exactly these names, or the names this test accepts. Only the outermost match is sent; a match
	 *  inside it goes with it. */
	match: MatchSpec;
	/** Renders a batch: one result per element, in order. Called once per chunk of the page with
	 *  that chunk's elements, and once per region answer. */
	render(
		elements: readonly RewriteElement[],
		ctx: RewriteContext
	): Promise<readonly RewriteResult[]> | readonly RewriteResult[];
}

/** A rewrite of the whole document or region answer. */
export interface PageRewrite {
	/** The whole document, or the whole region answer. A document it runs on is held until its last
	 *  chunk and rewritten once. */
	page(html: string, ctx: RewriteContext): Promise<string> | string;
}

/** What `.check()` found. */
export interface RewriteCheck {
	/** The HTML as ogygia would send it (marked, rewritten, settled, the restorer in place). */
	html: string;
	/** What went into `<head>` (a document), or what an answer carries for the head. */
	head: readonly string[];
	/** How many hosts ogygia restores. */
	restored: number;
	/** Each element whose render failed, with the reason; each one went out as ogygia rendered it. */
	failed: readonly { name: string; error: string }[];
	/** The parsed and restored DOM, when there is a DOM (vitest browser mode, jsdom); else `null`. */
	dom: Document | DocumentFragment | null;
	/** Each restored host whose light DOM is not exactly what Svelte rendered. */
	mismatches: readonly string[];
}

/** The response `.check()` stands in for. */
export interface CheckOptions {
	/** Default `'region'`. */
	kind?: RewriteKind;
	/** Default `false`. */
	csr?: boolean;
	/** Default: a GET for `/`. */
	event?: RequestEvent;
}

/** A rewrite: the Kit handle to list before `ogygia.handle()`. */
export type Rewrite = Handle & {
	/** The whole round trip on one piece of markup, for a test: mark, this rewrite, settle, then
	 *  (with a DOM) parse and restore, comparing every restored host with Svelte's original. */
	check(html: string, options?: CheckOptions): Promise<RewriteCheck>;
};

/** A page rewrite: also runs on a plain string. */
export type WholePageRewrite = Rewrite & {
	/** The page function on a plain string, outside any request (a proxy, a script). No marks. */
	html(html: string, ctx?: Partial<RewriteContext>): Promise<string>;
};
