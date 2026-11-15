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
	REGION,
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
	readonly placed: boolean;
	readonly of_is_promise: boolean;
	readonly waiting_ui: boolean;
	readonly of_init: RegionValue | undefined;
	readonly inputs: RegionInputs;
	readonly plan: RegionDecision;
	readonly tail: DocumentTail | null;
	readonly #baked: () => boolean;

	resolved: RegionValue | undefined;
	arm: RegionArm;

	constructor(
		settings: RegionSettings,
		of: () => RegionValue | Promise<RegionValue> | undefined,
		baked: () => boolean,
		waiting_ui: boolean,
		wake: () => string
	) {
		this.settings = settings;
		this.#baked = baked;
		this.waiting_ui = waiting_ui;
		this.of_is_promise = untrack(() => {
			const value = of();
			return !!value && !isRegion(value);
		});
		this.placed = settings.mode !== undefined;
		this.resolved = $derived(
			this.of_is_promise || this.placed ? undefined : (of() as RegionValue | undefined)
		);
		this.of_init = untrack(() => this.resolved);
		const server = typeof window === 'undefined';
		const req = server
			? (getContext(KIT_REQUEST_CONTEXT) as { event?: unknown } | undefined)
			: undefined;
		this.inputs = {
			kind: region_kind(
				settings.mode,
				this.of_init,
				this.of_is_promise,
				untrack(baked),
				waiting_ui
			),
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
		const plan = REGION.decide(this.inputs);
		this.plan = plan;
		this.arm = $derived(this.placed ? plan.arm : this.#held_arm());
		if (plan.warn === 'promise' && import.meta.env && import.meta.env.DEV) {
			warn('region_promise_no_placeholder');
		}
		if (plan.leave_live_snippet) setInLiveSnippet(false);
		if (plan.mark_pass) setContext(KIT_PAGE_PASS, true);
		this.tail = plan.tail ? document_tail() : null;
		if (plan.set_nested) setNested(true, wake);
		if (plan.hole_inline) setHoleInline();
	}

	#held_arm(): RegionArm {
		const kind = region_kind(
			undefined,
			this.resolved,
			this.of_is_promise,
			this.#baked(),
			this.waiting_ui
		);
		return REGION.decide({ ...this.inputs, kind }).arm;
	}
}
