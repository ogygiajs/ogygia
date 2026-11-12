/**
 * The state diagrams in the "how it flows" notes (internal/notes/flows/*.md), drawn from the
 * machines themselves (`graph()`), so a diagram cannot say something the code does not do.
 *
 *   node internal/checks/flow-graphs.ts           rewrites each diagram from the code
 *   node internal/checks/flow-graphs.ts --check   fails if a committed diagram drifted
 *
 * A note marks where a machine's diagram goes:
 *
 *   <!-- graph:navigation -->
 *   …written here…
 *   <!-- /graph -->
 *
 * `packages/core/test/flow-docs.test.ts` runs the same check with the core tests, so CI fails on
 * drift.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MachineGraph } from '../../packages/machine/src/index.ts';
import { navigation_graph } from '../../packages/core/src/runtime/navigation.ts';
import { wake_graph } from '../../packages/core/src/runtime/region-machines.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Each machine a note draws: its marker name, the note, and its graph. */
export const FLOWS: { name: string; note: string; graph: () => MachineGraph }[] = [
	{ name: 'navigation', note: 'internal/notes/flows/navigation.md', graph: navigation_graph },
	{ name: 'wake', note: 'internal/notes/flows/region-wake.md', graph: wake_graph }
];

/** A machine's graph as a Mermaid state diagram: every step, a timed step labelled with its wait. */
export function mermaid(graph: MachineGraph): string {
	const lines = ['```mermaid', 'stateDiagram-v2', `    [*] --> ${graph.initial}`];
	for (const s of graph.states) {
		for (const to of s.steps) {
			const timed = s.after?.to === to;
			const label = timed
				? `: after ${s.after?.ms === null ? 'its wait' : `${s.after?.ms} ms`}`
				: '';
			lines.push(`    ${s.kind} --> ${to}${label}`);
		}
		if (s.final) lines.push(`    ${s.kind} --> [*]`);
	}
	lines.push('```');
	return lines.join('\n');
}

/** `text` with the block for `name` rewritten from `graph`. Throws when the note has no marker. */
export function redraw(text: string, name: string, graph: MachineGraph): string {
	const open = `<!-- graph:${name} -->`;
	const start = text.indexOf(open);
	const end = text.indexOf('<!-- /graph -->', start);
	if (start < 0 || end < 0) throw new Error(`no <!-- graph:${name} --> … <!-- /graph --> block`);
	// (blank lines around the block, as the formatter writes them)
	return `${text.slice(0, start + open.length)}\n\n${mermaid(graph)}\n\n${text.slice(end)}`;
}

/** The notes whose diagram differs from the code, after rewriting them (unless `check`). */
export function flows(check: boolean): string[] {
	const drifted: string[] = [];
	for (const flow of FLOWS) {
		const path = join(ROOT, flow.note);
		const text = readFileSync(path, 'utf8');
		const next = redraw(text, flow.name, flow.graph());
		if (next === text) continue;
		drifted.push(flow.note);
		if (!check) writeFileSync(path, next);
	}
	return drifted;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const check = process.argv.includes('--check');
	const drifted = flows(check);
	for (const note of drifted)
		console.log(check ? `${note}: its diagram is not the code's` : `${note}: redrawn`);
	if (check && drifted.length) {
		console.log('Run `node internal/checks/flow-graphs.ts` and commit the notes.');
		process.exit(1);
	}
}
