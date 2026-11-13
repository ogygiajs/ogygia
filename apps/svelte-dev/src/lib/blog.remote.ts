/**
 * The blog wire layer — one remote: `post(slug)` resolves a post to its data + BAKED body. The body
 * is a serialized region (prebaked at compile time), awaited here so it crosses as an HTML-only
 * ticket via the transport hook, exactly like the docs' `doc` remote. Prerendered per slug.
 */
import { prerender } from '$app/server';
import * as v from 'valibot';
import { blog, type BlogData } from './site.server';
import { post_date } from './blog';
import type { RegionValue } from 'ogygia';

export type BlogPost = {
	slug: string;
	data: BlogData;
	/** ISO date recovered from the source filename (`2026-08-13-…`). */
	date: string | null;
	body?: RegionValue;
};

export const post = prerender(
	v.string(),
	async (slug): Promise<BlogPost | null> => {
		const entry = await blog.get(slug);
		if (!entry) return null;
		// `filePath` lives on the REF (the entry is the heavy face) — recover the date from the catalog.
		const ref = (await blog.refs()).find((r) => r.id === slug);
		// oxlint-disable-next-line typescript/await-thenable -- the body is region()'s AwaitableRegion, typed as the public RegionValue; typing it awaitable is a public type change, owner call
		const body = entry.body ? await entry.body : undefined;
		return {
			slug,
			data: entry.data,
			date: post_date(ref?.filePath),
			...(body ? { body } : {})
		};
	},
	{ dynamic: true }
);
