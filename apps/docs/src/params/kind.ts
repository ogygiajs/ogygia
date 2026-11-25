import type { ParamMatcher } from '@sveltejs/kit';
import { is_kind } from '$lib/releases/view';

// A release type in a /releases URL (`/releases/patch`), told apart from a package name.
export const match = ((param: string) => is_kind(param)) satisfies ParamMatcher;
