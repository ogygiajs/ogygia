/**
 * ADVERSARIAL stress suite for core's `import.meta.og.wire`. Same contract as the wire stress suite:
 * every input either does the RIGHT thing or FAILS LOUDLY (build-voice error), never silently
 * corrupts, never mistakes a comment/string for a call. The target is "input nobody would dream of
 * writing". (The plugins' macros have their halves in packages/content/test/constructs-stress.test.ts
 * and packages/bake/test/stress.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { rewrite_wire } from '../src/macros/wire.ts';

const MARKUP = ['.svelte'] as const;

describe('misuse-error QUALITY — build-voice, file:line, explains the fix', () => {
	const CODEC = `{ encode: (c) => c.v, decode: (v) => new C(v) }`;

	// wire: every illegal position
	it('wire as a bare value → [ogygia] + line + names the legal position', () => {
		try {
			rewrite_wire(`\nconst k = import.meta.og.wire;`, '/w.ts', MARKUP);
			throw new Error('should have thrown');
		} catch (e) {
			const m = String(e);
			expect(m).toContain('[ogygia]');
			expect(m).toMatch(/w\.ts:2/);
			expect(m).toMatch(/static wire = import\.meta\.og\.wire/); // shows the one legal shape
		}
	});
	it('wire as an object property → build-voice', () => {
		expect(() =>
			rewrite_wire(`const o = { w: import.meta.og.wire(${CODEC}) };`, '/w.ts', MARKUP)
		).toThrow(/\[ogygia\].*static class member/);
	});
	it('wire spread into a call → build-voice', () => {
		expect(() => rewrite_wire(`f(...import.meta.og.wire(${CODEC}))`, '/w.ts', MARKUP)).toThrow(
			/\[ogygia\].*static class member/
		);
	});
	it('non-static member named wire → build-voice', () => {
		expect(() =>
			rewrite_wire(`class C { wire = import.meta.og.wire(${CODEC}); }`, '/w.ts', MARKUP)
		).toThrow(/\[ogygia\]/);
	});
	it('static member with the WRONG name → names the required `wire`', () => {
		expect(() =>
			rewrite_wire(`class C { static codec = import.meta.og.wire(${CODEC}); }`, '/w.ts', MARKUP)
		).toThrow(/must be named exactly `wire`/);
	});
	it('arg-less wire() → codec required', () => {
		expect(() =>
			rewrite_wire(`class C { static wire = import.meta.og.wire(); }`, '/w.ts', MARKUP)
		).toThrow(/exactly one argument/);
	});
	it('2-arg wire(a,b) → exactly one argument', () => {
		expect(() =>
			rewrite_wire(`class C { static wire = import.meta.og.wire(${CODEC}, 1); }`, '/w.ts', MARKUP)
		).toThrow(/exactly one argument/);
	});
});

describe('.svelte multi-script-block interactions', () => {
	it('a <script> tag whose attribute contains a > (generics) extracts correctly', () => {
		const CODEC = `{ encode: (c) => c.v, decode: (v) => new C(v) }`;
		const src = `<script lang="ts" generics="T extends Array<number>">export class C { static wire = import.meta.og.wire(${CODEC}); }</script>`;
		const out = rewrite_wire(src, '/C.svelte', MARKUP);
		expect(out).toContain("static [Symbol.for('ogygia.wire')]");
		expect(out).toContain('generics="T extends Array<number>"'); // the tag attr survives intact
	});
});
