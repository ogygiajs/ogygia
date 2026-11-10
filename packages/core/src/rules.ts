/**
 * RULES AS CODE (#313). Each "always true" rule of an area is written once, as a plain function over
 * that area's state that names what it found broken (or null: kept), under the message code it
 * breaks with. The same function is checked wherever it is cheap to look:
 *
 * - in dev, after machine moves and navigations (the runtime) and after each response (the server),
 *   printing its code once per thing it found;
 * - in e2e, at the end of every test (`globalThis.__ogygia_rules()` in the page, read by the e2e
 *   harness's `rules(page)`).
 *
 * The areas keep their rules beside their code (./runtime/rules.ts, ./server/rules.ts) and register
 * them here. Rules exist in dev and in a build made with `OGYGIA_RULES=1` (the e2e suites'); in any
 * other build every call site folds out, and no rule ships (`__OGYGIA_RULES__`).
 */

const SAID_MAX = 200;

/** What a rule found broken (null: it holds). */
export type RuleCheck = () => string | null;

/** A rule found broken: its code, and what it found. */
export interface BrokenRule {
	readonly code: string;
	readonly detail: string;
}

/** One area's rules: each a check under its code. */
export class Rules<C extends string> {
	readonly #checks: Array<{ code: C; check: RuleCheck }> = [];
	/** What was said already (`code detail`): a rule that stays broken is said once. */
	readonly #said = new Set<string>();

	/** Adds a rule. */
	add(code: C, check: RuleCheck): void {
		this.#checks.push({ code, check });
	}

	/** Every rule broken now. A check that throws is broken, with its error. */
	broken(): BrokenRule[] {
		const out: BrokenRule[] = [];
		for (const { code, check } of this.#checks) {
			let detail: string | null;
			try {
				detail = check();
			} catch (error) {
				detail = `the check threw: ${String(error)}`;
			}
			if (detail !== null) out.push({ code, detail });
		}
		return out;
	}

	/** Checks every rule, and says each newly broken one (`say` prints its code). */
	say(say: (code: C, detail: string) => void): void {
		for (const b of this.broken()) {
			const key = `${b.code} ${b.detail}`;
			if (this.#said.has(key)) continue;
			// (a page with a rule broken a thousand ways says the first few hundred)
			if (this.#said.size >= SAID_MAX) return;
			this.#said.add(key);
			say(b.code as C, b.detail);
		}
	}
}
