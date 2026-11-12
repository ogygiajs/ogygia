# @ogygia/insights

The analysis engine behind ogygia's tools. It takes what the browser measured on a page visit, or
in a recorded session, and turns it into findings. Plain functions, no UI.

Published, because two published packages depend on it: `@ogygia/devtools` (the dock and the
profiler's report) and `@ogygia/testing`. One engine means the dock, the profiler and your tests
say the same thing about the same page. The docs app uses it too. Apps rarely import it themselves.

## Install

```bash
pnpm add @ogygia/insights
```

## Use

```ts
import { html_diff, rate } from '@ogygia/insights';

// what changed between the server's HTML and what the browser ended up with
const d = html_diff('<p>rendered on the server</p>', '<p>rendered on the browser</p>');
d.removed; // 1
d.added; // 1

rate('lcp', 3100); // 'fair' (good up to 2.5 s, poor from 4 s)
```

The bigger entry points are `analyze_page()` (one visit) and `analyze_session()` (a recording).

## Work on it

```bash
pnpm --filter @ogygia/insights test    # vitest
pnpm --filter @ogygia/insights check   # tsc on src and test, then vitest
pnpm --filter @ogygia/insights build   # tsdown
```

Bench files are in `bench/`.
