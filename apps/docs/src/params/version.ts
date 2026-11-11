import type { ParamMatcher } from '@sveltejs/kit';

// A released version in a /tests URL (`/tests/0.13.0`), told apart from a package name.
export const match = ((param: string) =>
	/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(param)) satisfies ParamMatcher;
