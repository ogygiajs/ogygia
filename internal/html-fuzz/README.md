# internal/html-fuzz

Test support for the differential HTML tests. ogygia reads and rewrites HTML with small scanners
(regexes, `indexOf` walks), because a full parser costs too much per request. A scanner is only
right if it reads what the browser reads. This package makes the awkward HTML a real page can carry
(odd quotes, `>` inside attribute values, comments, raw-text elements, any case, entities), and
reads it with parse5, the spec parser. A test then checks the scanner's answer against parse5's.

Internal. Never published. Tests reach it through `@ogygia/config/html-fuzz`, today in `core`,
`federation` and `postrender`. It lives outside `packages/` so the measurement-source gate does not
count it as package source.

## Use

```ts
import { fuzz, html_arb, parse_document, elements } from '@ogygia/config/html-fuzz';

fuzz(html_arb({ tags: ['meta', 'script'], attrs: ['name'], values: ['ogygia-router'] }), (html) => {
	const truth = elements(parse_document(html)).some((e) => e.name === 'meta' /* && … */);
	expect(page_declares_router_meta(html)).toBe(truth);
});
```

Runs are seeded (314 unless `OGYGIA_FUZZ_SEED` says), so CI tries the same inputs every time and a
failure replays. `OGYGIA_FUZZ_RUNS` sets how many inputs each property tries.

## Run

```bash
pnpm --filter ogygia-internal-html-fuzz check   # tsc
```

It has no tests of its own. The tests that use it run with their package.
