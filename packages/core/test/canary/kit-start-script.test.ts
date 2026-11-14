/**
 * CANARY (#1714, #1718): the shape of SvelteKit's inline start script, from the template in each
 * installed Kit's own page renderer (`src/runtime/server/page/render.js`). The start gate
 * (src/server/kit-gate.ts) rewrites the script's first `import("…")` so Kit starts after ogygia's
 * runtime, and `is_kit_boot_script` (src/runtime/kit-boot.ts) knows the script by its
 * `__sveltekit_*` global. Kit's `boot` expression is evaluated here for each way Kit loads its
 * client, and the gate is run over the script it makes.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_START_WAIT, kit_gate, kit_start_ungated } from '../../src/server/kit-gate.ts';
import { is_kit_boot_script } from '../../src/runtime/kit-boot.ts';
import { broke, KITS, type Internal } from './upstream.ts';

const START: Internal = {
	upstream: "SvelteKit's inline start script (`boot` in src/runtime/server/page/render.js)",
	used_by: [
		'packages/core/src/server/kit-gate.ts',
		'packages/core/src/hooks.ts (the csr=true path)'
	],
	issue: 1714
};
const GLOBAL: Internal = {
	upstream:
		"SvelteKit's `__sveltekit_*` global (its global name, src/runtime/server/utils.js or src/core/utils.js)",
	used_by: [
		'packages/core/src/runtime/kit-boot.ts (is_kit_boot_script)',
		'packages/core/src/server/html-scan.ts'
	],
	issue: 1718
};

/** The source of Kit's `const boot = …;` expression. */
function boot_expression(render_js: string): string | null {
	const from = render_js.indexOf('const boot =');
	const to = render_js.indexOf('if (load_env_eagerly)', from);
	if (from === -1 || to === -1) return null;
	return render_js
		.slice(from + 'const boot ='.length, to)
		.trim()
		.replace(/;$/, '');
}

const GLOBAL_NAME = '__sveltekit_abc123';

/** Kit's start script for one way of loading its client, as the browser gets it. */
function start_script(expr: string, client: object): string {
	// oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- evaluates Kit's own template expression, the point of the canary
	const boot = new Function(
		'client',
		's',
		'prefixed',
		'args',
		'serialized_data',
		'global',
		`return ${expr};`
	)(client, JSON.stringify, (p: string) => `./${p}`, ['element', '{}'], '', GLOBAL_NAME) as string;
	return [
		'',
		`${GLOBAL_NAME} = { base: "" };`,
		'const element = document.currentScript.parentElement;',
		boot,
		''
	].join('\n');
}

const page_with = (script: string) =>
	`<!doctype html><html><head></head><body><div><script>${script}</script></div></body></html>`;

describe.each(Object.entries(KITS))("%s's start script", (_, root) => {
	const render_js = fs.readFileSync(path.join(root, 'src/runtime/server/page/render.js'), 'utf8');
	const expr = boot_expression(render_js);

	it('builds its start script in one `boot` expression', () => {
		expect(
			expr,
			broke(START, 'render.js has no `const boot = …` before `load_env_eagerly`')
		).not.toBeNull();
	});

	it.each([
		['a split bundle (start + app)', { start: 'start.js', app: 'app.js' }],
		['a single entry', { start: 'start.js' }]
	])('the gate holds its start, %s', (_, client) => {
		const html = page_with(start_script(expr!, client));
		const end = html.lastIndexOf('</body>');
		const gate = kit_gate(html, end);
		expect(
			gate,
			broke(START, `the gate finds no \`import("…")\` in: ${start_script(expr!, client)}`)
		).not.toBeNull();
		expect(gate!.html).toContain(`${KIT_START_WAIT}.then(() => import("./start.js"))`);
		expect(kit_start_ungated(html, end)).toBe(false);
	});

	it('an inline bundle (nothing imported) is said ungated, so dev warns', () => {
		const html = page_with(start_script(expr!, { inline: { script: 'void 0;' } }));
		expect(kit_start_ungated(html, html.lastIndexOf('</body>'))).toBe(true);
	});

	it('names its global `__sveltekit_<hash>` (`__sveltekit_dev` in dev), assigned in the start script', () => {
		const utils = ['src/runtime/server/utils.js', 'src/core/utils.js']
			.map((f) => path.join(root, f))
			.filter((f) => fs.existsSync(f))
			.map((f) => fs.readFileSync(f, 'utf8'))
			.join('\n');
		expect(
			/`__sveltekit_\$\{/.test(utils),
			broke(GLOBAL, 'Kit no longer names its global `__sveltekit_${hash}`')
		).toBe(true);
		expect(
			utils,
			broke(GLOBAL, "get_global_name's dev name is no longer `__sveltekit_dev`")
		).toContain("'__sveltekit_dev'");
		expect(
			render_js,
			broke(GLOBAL, 'the start script no longer assigns `${global} = {`')
		).toContain('${global} = {');
		expect(
			is_kit_boot_script('', () => false, start_script(expr!, { start: 'start.js' })),
			broke(GLOBAL, 'is_kit_boot_script does not know the start script by its global')
		).toBe(true);
	});
});
