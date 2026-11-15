import { getContext, setContext, untrack } from 'svelte';
import { page } from '$app/state';
import { KIT_REQUEST_CONTEXT } from '../server/kit-context.ts';
import { document_tail, type DocumentTail } from '../server/document-tail.ts';
import { warn } from '../messages/island.ts';
import {
	isNested,
	setNested,
	isInLake,
	isInLiveSnippet,
	setInLiveSnippet,
	setHoleInline,
	documentIsCsrTrue
} from '../context.ts';
import { isRegion, type RegionValue } from '../region.ts';
import {
	REGION_PLANS,
	region_kind,
	request_state,
	type RegionArm,
	type RegionDecision,
	type RegionInputs,
	type RegionSettings
} from '../region-plan.ts';

const KIT_PAGE_PASS = Symbol.for('ogygia.kit-page-pass');

function page_error_render(): boolean {
	try {
		return page.error != null;
		// oxlint-disable-next-line ogygia/no-silent-failures -- isolated render without a live page (a hole endpoint, a remote's region)
	} catch {
		return false;
	}
}

/** One region's plan: the facts it reads from its settings, its value and the components above it,
 *  the table's decision for them, and the marks it leaves for the components below it. */
export class RegionPlan {
	readonly settings: RegionSettings;
	readonly of_is_promise: boolean;
	readonly waiting_ui: boolean;
	readonly of_init: RegionValue | undefined;
	readonly inputs: RegionInputs;
	readonly plan: RegionDecision;
	readonly tail: DocumentTail | null;
	readonly #of: () => RegionValue | Promise<RegionValue> | undefined;
	readonly #baked: () => boolean;

	resolved: RegionValue | undefined = $derived.by(() =>
		this.of_is_promise || this.placed ? undefined : (this.#of() as RegionValue | undefined)
	);
	arm: RegionArm = $derived.by(() => (this.placed ? this.plan.arm : this.#held_arm()));

	constructor(facts: {
		settings: RegionSettings;
		of: () => RegionValue | Promise<RegionValue> | undefined;
		baked: () => boolean;
		waiting_ui: boolean;
		of_is_promise: boolean;
		of_init: RegionValue | undefined;
		inputs: RegionInputs;
		plan: RegionDecision;
		tail: DocumentTail | null;
	}) {
		this.settings = facts.settings;
		this.#of = facts.of;
		this.#baked = facts.baked;
		this.waiting_ui = facts.waiting_ui;
		this.of_is_promise = facts.of_is_promise;
		this.of_init = facts.of_init;
		this.inputs = facts.inputs;
		this.plan = facts.plan;
		this.tail = facts.tail;
	}

	/** Whether the compiler placed this region (its settings name a mode), or it holds a value. */
	get placed(): boolean {
		return this.settings.mode !== undefined;
	}

	/** Reads a region's facts from its settings, its value and the components above it, decides its
	 *  plan, and leaves the marks the plan names for the components below it. */
	static read(
		settings: RegionSettings,
		of: () => RegionValue | Promise<RegionValue> | undefined,
		baked: () => boolean,
		waiting_ui: boolean,
		wake: () => string
	): RegionPlan {
		const first = untrack(of);
		const of_is_promise = !!first && !isRegion(first);
		const of_init =
			of_is_promise || settings.mode !== undefined ? undefined : (first as RegionValue | undefined);
		const server = typeof window === 'undefined';
		const req = server
			? (getContext(KIT_REQUEST_CONTEXT) as { event?: unknown } | undefined)
			: undefined;
		const inputs: RegionInputs = {
			kind: region_kind(settings.mode, of_init, of_is_promise, untrack(baked), waiting_ui),
			in_island: isNested(),
			live_snippet: isInLiveSnippet(),
			in_lake: isInLake(),
			pass_mark: server && getContext(KIT_PAGE_PASS) === true,
			request: request_state(req),
			csr_doc: documentIsCsrTrue(page_error_render()),
			server,
			module: !!settings.module,
			wakes: !!settings.wake
		};
		const plan = REGION_PLANS.decide(inputs);
		if (plan.warn === 'promise' && import.meta.env && import.meta.env.DEV) {
			warn('region_promise_no_placeholder');
		}
		if (plan.leave_live_snippet) setInLiveSnippet(false);
		if (plan.mark_pass) setContext(KIT_PAGE_PASS, true);
		const tail = plan.tail ? document_tail() : null;
		if (plan.set_nested) setNested(true, wake);
		if (plan.hole_inline) setHoleInline();
		return new RegionPlan({
			settings,
			of,
			baked,
			waiting_ui,
			of_is_promise,
			of_init,
			inputs,
			plan,
			tail
		});
	}

	#held_arm(): RegionArm {
		const kind = region_kind(
			undefined,
			this.resolved,
			this.of_is_promise,
			this.#baked(),
			this.waiting_ui
		);
		return REGION_PLANS.decide({ ...this.inputs, kind }).arm;
	}
}
