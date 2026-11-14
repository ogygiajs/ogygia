// SHIPPED COMPONENTS ARE TYPESCRIPT, AND COMPILE AS THEY SHIP. Every `.svelte` under
// `packages/*/src` ships as preprocessed source the app's own Svelte compiles
// (@ogygia/tsdown-plugin-svelte). Each one:
//   - writes every `<script>` as `lang="ts"`, with its types in TypeScript, never as JSDoc type
//     tags (`@type {…}`, `@param {…}`, `@typedef`…): one style, checked by svelte-check;
//   - holds no `<style>` literal inside a script (a preprocess pipeline that scans for style
//     elements by pattern feeds its contents to postcss, and svelte2tsx sees the script left open);
//   - compiles for the server and the client after the plugin's own preprocess and markup strip,
//     the way the app's Svelte will meet it.
//
//   node internal/checks/shipped-svelte.ts     name each finding, failing when there is one
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, parse, preprocess, type PreprocessorGroup } from 'svelte/compiler';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { strip_markup_ts } from '@ogygia/tsdown-plugin-svelte';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A JSDoc tag that carries a type: the TypeScript in the script says it instead. */
const JSDOC_TYPE_TAG =
	/@(?:type|typedef|callback|template|satisfies|import|enum|this)\b|@(?:param|arg|argument|returns?|prop|property|yields|throws)\s*\{/;

const STYLE_TAG = /<\/?style\b/;

interface Script {
	start: number;
	end: number;
	content: { start: number; end: number };
	attributes: { name: string; value: unknown }[];
}

interface Ast {
	instance?: Script | null;
	module?: Script | null;
	comments?: { value: string; start: number }[];
}

const line_at = (source: string, at: number): number => source.slice(0, at).split('\n').length;

function lang_of(script: Script): string | undefined {
	const attr = script.attributes.find((a) => a.name === 'lang');
	const value = Array.isArray(attr?.value) ? (attr.value[0] as { data?: string }) : undefined;
	return value?.data;
}

/** What one component's source breaks of the rules above (before it is compiled), as `line: why`. */
export function source_findings(source: string, filename: string): string[] {
	const ast = parse(source, { modern: true, filename }) as unknown as Ast;
	const out: string[] = [];
	for (const script of [ast.module, ast.instance]) {
		if (!script) continue;
		const line = line_at(source, script.start);
		if (lang_of(script) !== 'ts') out.push(`${line}: a <script> without lang="ts"`);
		const body = source.slice(script.content.start, script.content.end);
		const style = STYLE_TAG.exec(body);
		if (style)
			out.push(
				`${line_at(source, script.content.start + style.index)}: a <style> literal inside a <script>`
			);
	}
	for (const comment of ast.comments ?? []) {
		if (JSDOC_TYPE_TAG.test(comment.value))
			out.push(
				`${line_at(source, comment.start)}: a JSDoc type tag (write the type in TypeScript)`
			);
	}
	return out;
}

/** The component as it ships: the plugin's preprocess, then its markup strip. */
export async function as_shipped(
	source: string,
	filename: string,
	pre: PreprocessorGroup = vitePreprocess({ script: true })
): Promise<string> {
	const { code } = await preprocess(source, pre, { filename });
	return strip_markup_ts(code, filename);
}

/** Whether the shipped form compiles for both targets; a top-level `await` asks for async mode. */
export function compile_findings(shipped: string, filename: string): string[] {
	const out: string[] = [];
	for (const generate of ['server', 'client'] as const) {
		try {
			try {
				compile(shipped, { filename, generate });
			} catch (error) {
				if ((error as { code?: string }).code !== 'experimental_async') throw error;
				compile(shipped, { filename, generate, experimental: { async: true } });
			}
		} catch (error) {
			out.push(`does not compile for the ${generate} as shipped: ${(error as Error).message}`);
		}
	}
	return out;
}

/** Each tracked shipped component. */
export function shipped_components(root: string = ROOT): string[] {
	return execFileSync(
		'git',
		['ls-files', '-z', 'packages/*/src/*.svelte', 'packages/*/src/**/*.svelte'],
		{
			cwd: root,
			encoding: 'utf8'
		}
	)
		.split('\0')
		.filter((file) => /^packages\/[^/]+\/src\//.test(file));
}

/** Components not yet moved to TypeScript: each still has a source finding, and the list only
 *  shrinks (one that has none must leave it). It compiles as shipped like every other. */
export const PENDING: ReadonlySet<string> = new Set([
	'packages/devtools/src/devtools/BoundaryOverlay.svelte',
	'packages/devtools/src/devtools/Devtools.svelte',
	'packages/devtools/src/devtools/HubTab.svelte',
	'packages/devtools/src/devtools/HydrationTab.svelte',
	'packages/devtools/src/devtools/IslandDetail.svelte',
	'packages/devtools/src/devtools/LedgerTab.svelte',
	'packages/devtools/src/devtools/LensTab.svelte',
	'packages/devtools/src/devtools/NavTab.svelte',
	'packages/devtools/src/devtools/PageTab.svelte',
	'packages/devtools/src/devtools/ProfilerTab.svelte',
	'packages/devtools/src/devtools/PropsTree.svelte',
	'packages/devtools/src/devtools/SessionTab.svelte',
	'packages/devtools/src/devtools/TimelineTab.svelte',
	'packages/devtools/src/devtools/WireTab.svelte',
	'packages/router/src/LayoutChain.svelte'
]);

/** Every finding over every shipped component, as `file:line: why`. */
export async function find_all(root: string = ROOT): Promise<string[]> {
	const pre = vitePreprocess({ script: true });
	const found: string[] = [];
	for (const file of shipped_components(root)) {
		const abs = path.join(root, file);
		const source = readFileSync(abs, 'utf8');
		const findings = source_findings(source, abs);
		if (!PENDING.has(file)) for (const f of findings) found.push(`${file}:${f}`);
		else if (findings.length === 0)
			found.push(
				`${file}: is TypeScript now; take it off PENDING in internal/checks/shipped-svelte.ts`
			);
		for (const f of compile_findings(await as_shipped(source, abs, pre), abs))
			found.push(`${file}: ${f}`);
	}
	return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const found = await find_all();
	for (const at of found) console.error(at);
	if (found.length > 0) process.exit(1);
	console.log(
		`${shipped_components().length} shipped components: TypeScript, and they compile as shipped`
	);
}
