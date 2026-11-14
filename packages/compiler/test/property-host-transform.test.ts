// Properties of the host transform over generated `.svelte` hosts (both legs, csr=false):
// - the output parses as Svelte;
// - no import in it still names a region key: every marked import is rewritten to an
//   `ogygia:region/` module, under the same local name, and unmarked imports stay as written;
// - every region the host marks has a descriptor, and every island that runs code in the browser
//   has an entry (its loader) and a binding the host imports;
// - the same host compiles to the same output twice.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { fc } from '@ogygia/config/sim';
import { dedent } from '@ogygia/core/contract';
import { transformHost, wrapperVirtualId } from '../src/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

const HOST = '/app/src/routes/gen/+page.svelte';
type Ctx = Parameters<typeof transformHost>[2];

function ctx(ssr: boolean): Ctx {
	return {
		...HOST_CTX_DEFAULTS,
		ssr,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_host: string, iid: string) => wrapperVirtualId(iid),
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		pathModule: path
	} as Ctx;
}

/** The marks a generated import may carry; `null` is a plain import. */
const MARKS = [
	null,
	`wake: 'load'`,
	`wake: 'idle'`,
	`wake: 'visible'`,
	`wake: 'interaction'`,
	`wake: '(min-width: 600px)'`,
	`wake: 'none'`,
	`render: 'deferred'`,
	`render: 'deferred', fetch: 'idle'`,
	`render: 'deferred', fetch: 'visible'`,
	`render: 'deferred', fetch: 'interaction'`
] as const;

const REGION_KEY = /\bwith\s*\{[^}]*\b(wake|fetch|render|preset|region)\s*:/;

const a_host = fc
	.array(
		fc.record({
			file: fc.constantFrom('Card', 'Menu', 'Feed', 'Clock'),
			mark: fc.constantFrom(...MARKS),
			used: fc.boolean(),
			props: fc.constantFrom('', ' title="x"', ' n={1}', ' {...rest}', ' n={rest.n}'),
			place: fc.constantFrom('bare', 'if', 'each', 'children', 'twice')
		}),
		{ minLength: 1, maxLength: 5 }
	)
	.chain((parts) => fc.record({ parts: fc.constant(parts), ts: fc.boolean() }))
	.map(({ parts, ts }) => {
		const imports = parts.map((p, i) => {
			const spec = `'./${p.file}.svelte'`;
			return {
				local: `${p.file}${i}`,
				marked: p.mark !== null,
				used: p.used,
				text: p.mark
					? `import ${p.file}${i} from ${spec} with { ${p.mark} };`
					: `import ${p.file}${i} from ${spec};`
			};
		});
		const markup = parts
			.map((p, i) => {
				if (!p.used) return `<p>${i}</p>`;
				const tag = `<${p.file}${i}${p.props} />`;
				if (p.place === 'if') return `{#if rest.on}${tag}{/if}`;
				if (p.place === 'each') return `{#each [1, 2] as k (k)}${tag}{/each}`;
				if (p.place === 'children') return `<${p.file}${i}${p.props}><b>child</b></${p.file}${i}>`;
				if (p.place === 'twice') return `${tag}\n${tag}`;
				return tag;
			})
			.join('\n');
		const source = dedent`
			<script${ts ? ' lang="ts"' : ''}>
			${imports.map((x) => x.text).join('\n')}
			let { ...rest } = $props();
			</script>
			${markup}
		`;
		return { imports, source };
	});

/** The `from` specifier of each default import in the output, by local name. */
function imports_of(code: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of code.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["']/g)) out.set(m[1], m[2]);
	return out;
}

describe.each([false, true])('host transform properties (ssr: %s)', (ssr) => {
	it('rewrites every marked import, keeps the rest, parses, and is deterministic', () => {
		fc.assert(
			fc.property(a_host, ({ imports, source }) => {
				let out: ReturnType<typeof transformHost>;
				try {
					out = transformHost(source, HOST, ctx(ssr));
				} catch (e) {
					// the one refusal these hosts can earn: children on a region that cannot take them
					expect((e as { code?: string }).code, String(e)).toBe('region_children_not_portable');
					expect(source).toContain('<b>child</b>');
					return;
				}
				if (!imports.some((x) => x.marked)) return; // no mark: nothing to check
				expect(out).not.toBeNull();
				const code = out!.code;
				expect(() => parse(code, { modern: true })).not.toThrow();
				expect(code).not.toMatch(REGION_KEY);

				const got = imports_of(code);
				for (const x of imports) {
					if (!x.marked) expect(code).toContain(x.text);
					else if (x.used) expect(got.get(x.local), x.text).toMatch(/^ogygia:region\//);
					else expect(got.has(x.local), `unused ${x.local} is dropped`).toBe(false);
				}

				const islands = out!.islands;
				const bound = new Set(got.values());
				for (const isl of islands) {
					const ref = [isl.bindingPath, isl.wrapperPath].filter(Boolean) as string[];
					expect(
						ref.some((r) => bound.has(r)),
						`island ${isl.id} is imported by the host`
					).toBe(true);
					if ((isl.kind ?? 'hydrate') === 'hydrate' && !isl.server) {
						expect(isl.virtualPath, `island ${isl.id} has an entry`).toMatch(
							/^ogygia:region\/entry\//
						);
					}
				}
				// each used marked import is one region (same file and mark may share one id)
				const placed = imports.filter((x) => x.marked && x.used).length;
				expect(islands.length > 0).toBe(placed > 0);
				expect(islands.length).toBeLessThanOrEqual(placed);

				expect(transformHost(source, HOST, ctx(ssr))!.code).toBe(code);
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 314),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 150)
			}
		);
	});
});
