// Flag evaluation, per read per request: sticky rollouts, weighted variants, a mutual-exclusion
// layer, the `?og-exp` override and a context rule, read for a crowd of visitors. Each visitor is
// a fresh request (reads are memoized per request, as on a real server).
import { bench } from '@bench/heisenbench/bench';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { decide, flag, type CtxLike } from '../src/index.ts';
import server from '../src/server.ts';

startPlugin(server, { name: '@ogygia/flags' });
decide({ overrides: () => true, source: undefined, exposure: undefined });

const checkout = flag('checkout-v2', 25);
const hero = flag('hero', { control: 2, video: 1, quiz: 1 });
const hero_video = flag('hero-video', 100, { layer: 'hero-surface' });
const hero_quiz = flag('hero-quiz', 100, { layer: 'hero-surface' });
const pricing = flag('pricing', { a: 1, b: 1, c: 1, d: 1 });
const beta = flag('beta', (c: CtxLike) => c.url.searchParams.has('beta') || undefined);

const FLAGS = [checkout, hero, hero_video, hero_quiz, pricing, beta];

function visitor(i: number): CtxLike {
	const url = `https://example.test/catalog?page=${i % 5}${i % 9 === 0 ? '&og-exp=pricing:c' : ''}${i % 13 === 0 ? '&beta' : ''}`;
	return {
		request: new Request(url),
		url: new URL(url),
		cookies: { get: (n: string) => (n === 'og-vid' ? `v-${i}` : undefined) }
	};
}

bench(
	'flags: six flags read for 500 visitors',
	({ crowd }) => {
		let on = 0;
		for (const c of crowd) {
			for (const f of FLAGS) {
				const v = f(c);
				if (v !== false && v !== 'control' && v !== 'a') on++;
			}
		}
		return on;
	},
	{
		setup: () => ({ crowd: Array.from({ length: 500 }, (_, i) => visitor(i)) }),
		scale: (_ctx, k) => ({ crowd: Array.from({ length: 500 * k }, (_, i) => visitor(i)) })
	}
);

bench(
	'flags: the same flags read again in one request (memoized)',
	({ c }) => {
		let n = 0;
		for (let i = 0; i < 200; i++) for (const f of FLAGS) n += String(f(c)).length;
		return n;
	},
	{ setup: () => ({ c: visitor(7) }) }
);
