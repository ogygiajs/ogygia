import { random } from '@ogygia/machine';
import type { Ctx, Visitor } from './ctx.ts';

export interface AnonymousVisitorOptions {
	/** Cookie name (default `og-vid` — the same one experiment()'s fallback chain reads). */
	cookie?: string;
	/** Cookie lifetime in days (default 365). */
	days?: number;
}

/**
 * A visitor resolver for logged-out traffic, so experiments, flags and rollouts stay sticky for
 * anonymous visitors too (with no identity, a split falls back to control). It mints a random id
 * into a first-party cookie on first sight and returns it as `{ vid }` after that. It is never
 * `sub`, a signed-in user's id that `mount()` signs onward to peers: the cookie is whatever the
 * browser sends. The id is not a fingerprint and carries nothing; clearing the cookie rotates it.
 *
 *     routes(table, { visitor: anonymousVisitor() })
 *     routes(table, { visitor: (c) => session(c) ?? anon(c) })
 */
export function anonymousVisitor(
	opts: AnonymousVisitorOptions = {}
): (c: Ctx) => Visitor | undefined {
	const name = opts.cookie ?? 'og-vid';
	const max_age = (opts.days ?? 365) * 86_400;
	return (c) => {
		const existing = c.cookies?.get(name);
		if (existing) return { vid: existing, anonymous: true };
		const id = random.uuid();
		if (c.cookies?.set) {
			c.cookies.set(name, id, {
				path: '/',
				maxAge: max_age,
				httpOnly: true,
				sameSite: 'lax'
			});
		} else {
			c.setHeaders?.({
				'set-cookie': `${name}=${id}; Path=/; Max-Age=${max_age}; HttpOnly; SameSite=Lax`
			});
		}
		return { vid: id, anonymous: true };
	};
}
