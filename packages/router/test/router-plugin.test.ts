// `router()` (src/vite.ts): the plugin tells the build that every module importing
// `@ogygia/router` is a page module, so the components it reaches get their CSS linked.
import { expect, test } from 'vitest';
import { router } from '../src/vite.ts';

type Definition = { name: string; build?: (b: unknown) => void };

test('router() marks every module importing @ogygia/router as a page module', () => {
	const plugin = router() as unknown as Record<symbol, Definition>;
	const definition = plugin[Symbol.for('ogygia.plugin')];
	expect(definition.name).toBe('@ogygia/router');
	const asked: unknown[] = [];
	definition.build!({ pageModules: (spec: unknown) => asked.push(spec) });
	expect(asked).toEqual([{ importers: ['@ogygia/router'] }]);
});
