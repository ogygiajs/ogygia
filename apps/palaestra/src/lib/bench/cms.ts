// The data of a large CMS page (about 8,000 elements and 1,600 links at the defaults): a mega-menu
// header, `sections` content sections with lists, facts, cards and a few forms, a link footer, and
// a stylesheet of `rules` rules. Query params `?sections=N&rules=N` grow it, to show how a cost
// scales with the DOM. Used by /bench-cms/no-regions and /bench-cms/holes.
const word = (i: number) => ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma'][i % 6];

export function cms_page(url: URL) {
	const base = url.pathname;
	return {
		css: Array.from(
			{ length: Number(url.searchParams.get('rules') ?? 3000) },
			(_, i) =>
				`[data-cms-page] section:nth-child(${(i % 40) + 1}) .cards article:not(.x${i}) > ${['p', 'h3', 'a', 'img'][i % 4]}:hover { color: rgb(${i % 255} 0 0); }`
		).join('\n'),
		menus: Array.from({ length: 8 }, (_, m) => ({
			label: `Menu ${m}`,
			columns: Array.from({ length: 6 }, (_, c) => ({
				title: `Column ${m}.${c}`,
				links: Array.from({ length: 12 }, (_, l) => ({
					href: `${base}/m${m}/c${c}/l${l}`,
					label: `${word(l)} ${m}.${c}.${l}`
				}))
			}))
		})),
		sections: Array.from({ length: Number(url.searchParams.get('sections') ?? 80) }, (_, s) => ({
			id: `s${s}`,
			title: `Section ${s}`,
			text: `${word(s)} text of section ${s}, long enough to wrap on a phone screen.`,
			facts: Array.from({ length: 10 }, (_, f) => ({ term: `${word(f)} ${f}`, value: `${s * f}` })),
			items: Array.from({ length: 6 }, (_, i) => ({
				href: `${base}/s${s}/i${i}`,
				label: `${word(i)} item ${s}.${i}`
			})),
			cards: Array.from({ length: 6 }, (_, c) => ({
				href: `${base}/s${s}/card${c}`,
				title: `Card ${s}.${c}`,
				text: `${word(c)} card body`
			}))
		})),
		footer: Array.from({ length: 8 }, (_, f) => ({
			title: `Footer ${f}`,
			links: Array.from({ length: 12 }, (_, l) => ({
				href: `${base}/f${f}/l${l}`,
				label: `${word(l)} ${f}.${l}`
			}))
		}))
	};
}

export type CmsPage = ReturnType<typeof cms_page>;
