// The prescan's question, "does this module define a wire class?", must have the answer the
// registration gives when it appends `__register_transportable` for the module. A class the prescan
// misses gets no loader and no eager import, and the `wire` mark stays off: it fails to decode in
// production. One that the prescan counts but nothing registers is imported into every realm for
// nothing. Pinned by forms, then by a differential over generated class modules (seeded 9;
// OGYGIA_FUZZ_SEED, OGYGIA_FUZZ_RUNS).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { dedent } from '@ogygia/core/contract';
import {
	appendTransportRegistrations,
	moduleHasTransportable
} from '../src/compiler/transportables.ts';

const FILE = '/app/src/lib/cart.ts';
const registers = (src: string) =>
	(appendTransportRegistrations(src, FILE, '/app') ?? '').includes('__OGT(');

const CODEC = '{ encode: (c) => c.items, decode: (items) => new Cart(items) }';

describe('the prescan counts a wire class exactly when the registration registers it', () => {
	it.each([
		['a plain member', `export class Cart { static wire = import.meta.og.wire(${CODEC}); }`],
		[
			'a typed member',
			`export class Cart { static wire: Codec<Cart> = import.meta.og.wire(${CODEC}); }`
		],
		[
			'a readonly member',
			`export class Cart { static readonly wire = import.meta.og.wire(${CODEC}); }`
		],
		[
			'a member over two lines',
			dedent`
				export class Cart {
					static wire =
						import.meta.og.wire(${CODEC});
				}
			`
		],
		[
			'the rewritten member',
			`export class Cart { static [Symbol.for('ogygia.wire')] = ${CODEC}; }`
		],
		[
			'an export list',
			`class Cart { static wire = import.meta.og.wire(${CODEC}); }\nexport { Cart };`
		],
		['a computed static that is no codec', 'export class Bag { static [Symbol.iterator]() {} }'],
		['a class nobody exports', `class Cart { static wire = import.meta.og.wire(${CODEC}); }`],
		['the construct in a comment', '// static wire = import.meta.og.wire\nexport class Cart {}']
	])('%s', (_name, src) => {
		expect(moduleHasTransportable(src, FILE)).toBe(registers(src));
	});

	it('agrees over generated class modules', () => {
		const member = fc.record({
			key: fc.constantFrom(
				'wire',
				'codec',
				'#wire',
				"[Symbol.for('ogygia.wire')]",
				'[Symbol.iterator]'
			),
			readonly: fc.boolean(),
			type: fc.constantFrom('', ': Codec<Cart>', ': any'),
			gap: fc.constantFrom(' ', '\n\t\t', '  '),
			value: fc.constantFrom(`import.meta.og.wire(${CODEC})`, CODEC, 'null')
		});
		const module = fc.record({
			members: fc.array(member, { maxLength: 3 }),
			exported: fc.constantFrom('decl', 'list', 'none')
		});
		fc.assert(
			fc.property(module, ({ members, exported }) => {
				const body = members
					.map(
						(m) => `\tstatic ${m.readonly ? 'readonly ' : ''}${m.key}${m.type} =${m.gap}${m.value};`
					)
					.join('\n');
				const lines = [exported === 'decl' ? 'export class Cart {' : 'class Cart {', body, '}'];
				if (exported === 'list') lines.push('export { Cart };');
				const src = lines.join('\n');
				expect(moduleHasTransportable(src, FILE), src).toBe(registers(src));
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 9),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 300)
			}
		);
	});
});

// The raw file the prescan reads is not always what the build compiles (a preprocessor or another
// plugin may run first). A miss loses the loader and the wire mark; an extra answer loads one module.
describe('a module the prescan cannot parse', () => {
	it('counts as one that may define a wire class (#1486)', () => {
		const src = `export class Cart { static wire = import.meta.og.wire(${CODEC}); }\nconst x = <div />;`;
		expect(moduleHasTransportable(src, FILE)).toBe(true);
	});

	it('still needs a class and a static to be counted', () => {
		expect(moduleHasTransportable('const x = <div />;', FILE)).toBe(false);
	});
});
