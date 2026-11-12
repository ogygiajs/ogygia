// A `.ts` registry, three shapes in one file:
//   - `with { wake: 'visible' }`  → a MOUNTABLE held binding (default import). Placed via
//     `<svelte:component>` like Builder's SDK does; renders the `<ogygia-region>` shell, JS on `visible`.
//   - `with { region: 'raw' }`    → a bare HELD descriptor, rendered through `region()` + `<Region>`.
//   - `import { Ticker } from './barrel' with { wake }` → the SAME mountable held binding, marking a
//     NAMED barrel import.
import TsRegWidget from './TsRegWidget.svelte' with { wake: 'visible' };
import TsRegRaw from './TsRegRaw.svelte' with { region: 'raw' };
import { Ticker as TickerRegion } from './barrel' with { wake: 'visible' };

export const registry: Array<{ name: string; component: unknown }> = [
	{ name: 'tsreg-widget', component: TsRegWidget },
	{ name: 'tsreg-raw', component: TsRegRaw },
	{ name: 'tsreg-asregion', component: TickerRegion }
];
