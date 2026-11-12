import type { SchemaLike } from '../index.ts';

/** What every ogygia surface reads off a page. `title` is required; the rest carry blessed defaults. */
export type PageFields = {
	title: string;
	summary: string;
	draft: boolean;
	badge?: string;
	redirect_from?: string | string[];
	related: string[];
};

const is_str = (v: unknown): v is string => typeof v === 'string';
const str_array = (v: unknown): string[] => (Array.isArray(v) ? v.filter(is_str) : []);

type FieldSchema<Out> = SchemaLike & { readonly ['~standard']: { types?: { output: Out } } };

function schema<Out>(
	vendor: string,
	run: (data: Record<string, unknown>) => Out
): FieldSchema<Out> {
	return {
		['~standard']: {
			version: 1 as const,
			vendor,
			validate(value: unknown) {
				const data = (value ?? {}) as Record<string, unknown>;
				try {
					return { value: run(data) };
				} catch (e) {
					return { issues: [{ message: e instanceof Error ? e.message : String(e) }] };
				}
			}
		}
	} as SchemaLike & { readonly ['~standard']: { types?: { output: Out } } };
}

const page: FieldSchema<PageFields> = schema<PageFields>('ogygia-content/page', (d) => {
	if (!is_str(d.title) || !d.title) throw new Error('frontmatter needs a non-empty `title`');
	const out: PageFields = {
		title: d.title,
		summary: is_str(d.summary) ? d.summary : '',
		draft: d.draft === true,
		related: str_array(d.related)
	};
	if (is_str(d.badge)) out.badge = d.badge;
	if (is_str(d.redirect_from) || Array.isArray(d.redirect_from)) {
		out.redirect_from = is_str(d.redirect_from) ? d.redirect_from : str_array(d.redirect_from);
	}
	return out;
});

/** Extra fields a blog post carries beyond a page (a Blog shell reads these; the brains do not). */
export type PostFields = { date: string; author?: string; tags: string[] };

/** A post as the blog INDEX lists it (`<BlogList posts>`): the display fields + its href. Map a
 *  collection's refs to this over the wire so the corpus stays server-side. */
export type BlogPostRef = {
	href: string;
	title: string;
	date: string;
	summary?: string;
	author?: string;
	tags?: string[];
};
const post_only: FieldSchema<PostFields> = schema<PostFields>('ogygia-content/post', (d) => {
	if (!is_str(d.date) || !d.date) throw new Error('a post needs a `date`');
	const out: PostFields = { date: d.date, tags: str_array(d.tags) };
	if (is_str(d.author)) out.author = d.author;
	return out;
});

/** Extra fields a changelog entry carries beyond a page. */
export type ChangeFields = { version: string; date: string };
const change_only: FieldSchema<ChangeFields> = schema<ChangeFields>(
	'ogygia-content/change',
	(d) => {
		if (!is_str(d.version) || !d.version) throw new Error('a changelog entry needs a `version`');
		if (!is_str(d.date) || !d.date) throw new Error('a changelog entry needs a `date`');
		return { version: d.version, date: d.date };
	}
);

/**
 * The site's frontmatter schemas, as Standard Schemas with no validation library behind them.
 * `page` keeps exactly what the site reads off a page (title, summary, draft, badge, redirect_from,
 * related) and drops the rest; a page without a title is an issue. `post` and `change` are stacks
 * (page + genre extras) for `content({ schema })`, which merges array layers left to right:
 *
 * ```ts
 * content({ loader, schema: fields.page });
 * content({ loader, schema: [fields.page, v.object({ author: v.string() })] });
 * content({ loader, schema: fields.post });
 * ```
 */
export const fields: {
	page: typeof page;
	post: [typeof page, typeof post_only];
	change: [typeof page, typeof change_only];
} = {
	page,
	post: [page, post_only] as [typeof page, typeof post_only],
	change: [page, change_only] as [typeof page, typeof change_only]
};
