// The prescan's question, "does this module define a wire class?", must have the answer the
// registration gives when it appends `__register_transportable` for the module. A class the prescan
// misses gets no loader and no eager import, and the `wire` mark stays off: it fails to decode in
// production. One that the prescan counts but nothing registers is imported into every realm for
// nothing. Pinned by forms, then by a differential over generated class modules (seeded 9;
// OGYGIA_FUZZ_SEED, OGYGIA_FUZZ_RUNS).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
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
			`export class Cart {\n\tstatic wire =\n\t\timport.meta.og.wire(${CODEC});\n}`
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
				const src =
					exported === 'decl'
						? `export class Cart {\n${body}\n}`
						: `class Cart {\n${body}\n}${exported === 'list' ? '\nexport { Cart };' : ''}`;
				expect(moduleHasTransportable(src, FILE), src).toBe(registers(src));
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 9),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 300)
			}
		);
	});
});
