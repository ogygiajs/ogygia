# @ogygia/testing

Testing for [ogygia](https://ogygiajs.dev): the devtools and the profiler as test primitives. Your Playwright tests click through the app as usual; ogygia measures hydration, interactions, server time and weight, and your test fails on a budget.

## Install

```bash
pnpm add -D @ogygia/testing @playwright/test
```

The app under test lists `testing()` from `@ogygia/testing/vite` beside `ogygia()` (and `devtools({ profiler: true })` from `@ogygia/devtools` for `profile()`). The fixture injects the testing engine into each page; `testing()` hands it the runtime's hooks. A visitor has no engine, so nothing of it runs.

## Use

```ts
// tests/fixtures.ts
import { test as base, expect as baseExpect } from '@playwright/test';
import { withOgygia } from '@ogygia/testing';

export const { test, expect } = withOgygia(base, baseExpect);
```

```ts
test('checkout stays fast', async ({ page, ogygia }) => {
	await page.goto('/cart');
	expect(await ogygia.page()).toMeetBudget({ lcp: 2500, cls: 0.1 });
	expect(await ogygia.hydration()).toHydrateCleanly();
});
```

Docs: [@ogygia/testing](https://ogygiajs.dev/docs/testing/overview), with the full [Testing](https://ogygiajs.dev/docs/testing/guide) guide.
