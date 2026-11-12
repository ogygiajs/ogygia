// The page insights the devtools read from a visit: what the largest paint's download shared the
// network with, on a long page of images below the first screen.
import { bench } from '@bench/heisenbench/bench';
import { lcp_rivals, type PageInput } from '../src/page-insights.ts';
import { barrel_left_fix, barrel_left_words } from '../src/barrel-left.ts';
import { BARREL_LEFT_REASONS } from '../../core/src/contract/barrels.ts';

/** A visit whose hero image downloads beside `images` eager images far below the first screen
 *  (every third one a copy of another under a new query), among twice as many other files. */
function long_page(images: number): NonNullable<PageInput['visit']> {
	const hero = 'https://shop.test/img/hero.jpg';
	const resources: NonNullable<NonNullable<PageInput['visit']>['resources']> = [
		{ url: hero, type: 'img', start: 40, req_start: 45, end: 2650 }
	];
	const below: NonNullable<NonNullable<PageInput['visit']>['images_eager_below']> = [];
	for (let i = 0; i < images; i++) {
		const url = `https://shop.test/img/product-${i % 3 === 2 ? i - 1 : i}.jpg?w=${400 + i}`;
		resources.push(
			{ url: `https://shop.test/_app/chunk-${i}.js`, type: 'script', start: 30 + i, end: 300 + i },
			{ url, type: 'img', start: 100 + i * 7, end: 900 + i * 11 }
		);
		below.push({ url, top: 2400 + i * 300, bytes: 40_000 + i * 10 });
	}
	return {
		nav: { res_start: 20 },
		paints: { fcp: 100, lcp: 2700, lcp_url: hero, lcp_tag: 'img' },
		viewport: [1400, 900],
		resources,
		images_eager_below: below
	};
}

// Growth: linear in the page's images. It was quadratic while each image looked up its download
// in the whole list of the visit's files.
bench(
	'lcp_rivals: the images that downloaded beside the hero, as the page grows',
	({ visit }) => lcp_rivals(visit)?.files.length ?? 0,
	{
		setup: () => ({ visit: long_page(30) }),
		scale: (_ctx, k) => ({ visit: long_page(30 * k) })
	}
);

// The words for why a barrel stayed: every reason alone, then all of them at once, as the finding
// and its fix put them.
bench(
	'barrel_left_words and barrel_left_fix: each reason, then every reason together',
	({ sets }) => {
		let n = 0;
		for (const why of sets) n += barrel_left_words(why).length + barrel_left_fix(why).length;
		return n;
	},
	{
		setup: () => ({
			sets: [undefined, ...BARREL_LEFT_REASONS.map((r) => [r]), [...BARREL_LEFT_REASONS]]
		})
	}
);
