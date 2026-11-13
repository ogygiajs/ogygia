// Flag evaluation, per read per request: sticky rollouts, weighted variants, a mutual-exclusion
// layer, the `?og-exp` override and a context rule, read for a crowd of visitors. Each visitor is
// a fresh request (reads are memoized per request, as on a real server).
import { bench } from '@bench/heisenbench/bench';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { dedent } from '@ogygia/core/plugin/utils';
import { decide, flag, flush_exposures, type CtxLike } from '../src/index.ts';
import { collect_flag_sites } from '../src/inventory.ts';
import { FLAGS_WARNINGS } from '../src/messages.ts';
import server from '../src/server.ts';

const { ctx } = startPlugin(server, { name: '@ogygia/flags' });
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

// The exposure queue: reads buffer exposures, each request's end sends them (one send at a time,
// what is read meanwhile goes in the next), and a sink that fails is said, not thrown.
bench(
	'flags: exposures of 200 requests sent at each request end, through a sink that sometimes fails',
	async ({ crowd }) => {
		const quiet = console.warn;
		console.warn = () => {};
		let sends = 0;
		let events = 0;
		decide({
			exposure: async (batch) => {
				await Promise.resolve();
				if (++sends % 5 === 0) throw new Error('pipeline down');
				events += batch.length;
			},
			batch: { max: 8, ms: 1 }
		});
		try {
			// requests one after another, two at a time in flight: the second's exposures wait for the
			// first's send
			for (let i = 0; i < crowd.length; i += 2) {
				for (const f of FLAGS) f(crowd[i]);
				const first = server.done!(ctx(crowd[i].request));
				if (i + 1 < crowd.length) for (const f of FLAGS) f(crowd[i + 1]);
				const second = i + 1 < crowd.length ? server.done!(ctx(crowd[i + 1].request)) : undefined;
				await Promise.all([first, second]);
			}
			// reads outside a request: the age cap sends them
			for (const f of FLAGS) f(visitor(crowd.length));
			await new Promise((r) => setTimeout(r, 5));
			await flush_exposures();
		} finally {
			decide({ exposure: undefined, batch: { max: 25, ms: 2000 } });
			console.warn = quiet;
		}
		const said = FLAGS_WARNINGS.flags_exposure_failed;
		return sends * 1000 + events + said.text().length + said.details().length;
	},
	{
		setup: () => ({ crowd: Array.from({ length: 200 }, (_, i) => visitor(i)) }),
		scale: (_ctx, k) => ({ crowd: Array.from({ length: 200 * k }, (_, i) => visitor(i)) })
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

/** A module declaring `flags` flags, each among a few lines of other code. */
function flags_module(flags: number): string {
	let src = `${dedent`
		import { flag } from '@ogygia/flags';
		import { format } from '$lib/format';
	`}\n\n`;
	for (let i = 0; i < flags; i++)
		src = `${dedent`
			${src}export const flag${i} = flag('flag-${i}', { a: 50, b: 50 });
			export const label${i} = format('label ${i}');
		`}\n\n`;
	return src;
}

// Growth: the inventory is linear in the module's size. It was quadratic while each flag's line
// was counted from the top of the file.
bench(
	'flag inventory: the flag calls of a module as it grows',
	({ source }) => collect_flag_sites(source, '/app/src/lib/flags.ts', 'src/lib/flags.ts').length,
	{
		setup: () => ({ source: flags_module(20) }),
		scale: (_ctx, k) => ({ source: flags_module(20 * k) })
	}
);
