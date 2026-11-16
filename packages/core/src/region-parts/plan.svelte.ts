import { getContext, setContext, untrack } from 'svelte';
import { page } from '$app/state';
import { KIT_REQUEST_CONTEXT, kit_request_event } from '../server/kit-context.ts';
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
import { HOLE_SLOT_SEQUENCE, next_slot_id } from '../region-snippet.ts';
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
	readonly #settings: RegionSettings;
	readonly #of: () => RegionValue | Promise<RegionValue> | undefined;
	readonly #baked: () => boolean;
	readonly #waiting_ui: boolean;
	readonly #wake: () => string;
	readonly of_is_promise: boolean;
	readonly of_init: RegionValue | undefined;
	readonly inputs: RegionInputs;
	readonly plan: RegionDecision;
	readonly tail: DocumentTail | null;
	readonly slot_id: string;

	resolved: RegionValue | undefined = $derived.by(() =>
		this.of_is_promise || this.placed ? undefined : (this.#of() as RegionValue | undefined)
	);
	arm: RegionArm = $derived.by(() => (this.placed ? this.plan.arm : this.#held_arm()));

	/** Reads a region's facts from its settings, its value and the components above it, decides its
	 *  plan, leaves the marks the plan names for the components below it, and claims its slot id
	 *  (every region claims one, so the ids after it stay put). */
	constructor(
		settings: RegionSettings,
		of: () => RegionValue | Promise<RegionValue> | undefined,
		baked: () => boolean,
		waiting_ui: boolean,
		wake: () => string
	) {
		this.#settings = settings;
		this.#of = of;
		this.#baked = baked;
		this.#waiting_ui = waiting_ui;
		this.#wake = wake;
		const first = untrack(of);
		this.of_is_promise = !!first && !isRegion(first);
		this.of_init =
			this.of_is_promise || this.placed ? undefined : (first as RegionValue | undefined);
		this.inputs = untrack(() => this.#read_inputs());
		this.plan = REGION_PLANS.decide(this.inputs);
		untrack(() => this.#mark());
		this.tail =
			this.plan.tail && (import.meta.env?.SSR ?? typeof window === 'undefined')
				? document_tail()
				: null;
		this.slot_id = untrack(() => next_slot_id(this.#slot_entry(), getContext(HOLE_SLOT_SEQUENCE)));
	}

	/** The settings the compiler wrote for this region. */
	get settings(): RegionSettings {
		return this.#settings;
	}

	/** Whether the compiler placed this region (its settings name a mode), or it holds a value. */
	get placed(): boolean {
		return this.#settings.mode !== undefined;
	}

	#read_inputs(): RegionInputs {
		const server = import.meta.env?.SSR ?? typeof window === 'undefined';
		const s = this.#settings;
		return {
			kind: region_kind(s.mode, this.of_init, this.of_is_promise, this.#baked(), this.#waiting_ui),
			in_island: isNested(),
			live_snippet: isInLiveSnippet(),
			in_lake: isInLake(),
			pass_mark: server && getContext(KIT_PAGE_PASS) === true,
			request: request_state(
				server ? (getContext(KIT_REQUEST_CONTEXT) as { event?: unknown } | undefined) : undefined
			),
			csr_doc: documentIsCsrTrue(page_error_render()),
			server,
			module: !!s.module,
			wakes: !!s.wake
		};
	}

	#mark(): void {
		const plan = this.plan;
		if (plan.warn === 'promise' && import.meta.env && import.meta.env.DEV) {
			warn('region_promise_no_placeholder');
		}
		if (plan.leave_live_snippet) setInLiveSnippet(false);
		if (plan.mark_pass) setContext(KIT_PAGE_PASS, true);
		if (plan.fill_event) {
			const event = kit_request_event();
			if (event)
				setContext(KIT_REQUEST_CONTEXT, { ...getContext<object>(KIT_REQUEST_CONTEXT), event });
		}
		if (plan.set_nested) setNested(true, this.#wake);
		if (plan.hole_inline) setHoleInline();
	}

	#slot_entry(): string {
		const init = this.of_init;
		if (this.plan.family === 'island' && init?.kind === 'dual') return init.module;
		return this.#settings.mode === 'island' ? (this.#settings.entry ?? '') : '';
	}

	#held_arm(): RegionArm {
		const kind = region_kind(
			undefined,
			this.resolved,
			this.of_is_promise,
			this.#baked(),
			this.#waiting_ui
		);
		return REGION_PLANS.decide({ ...this.inputs, kind }).arm;
	}
}
