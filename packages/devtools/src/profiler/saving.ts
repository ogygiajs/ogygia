/**
 * What a set of savings (each already one per group: no two share a line) takes off one render of
 * `now` ms together. EACH RESOURCE CAPPED BY WHAT THE RENDER USED: every saving on the clock (the
 * wait fixes and the waits deleted) takes off at most the render's waiting; every CPU saving at most
 * its CPU. Past that they overlap in a way the lines do not show. Never the whole render: what
 * serves it (routing, the response) stays.
 *
 * The forecast, the compare's fix check and the report page's "pick your fixes" all count with
 * this; the module imports nothing, so the page runs it in the browser.
 */
export function saving_of(
	set: readonly { ms: number; wait: boolean; kind: string }[],
	caps: { wait?: number; cpu?: number },
	now: number
): {
	cpu: number;
	wait: number;
	del: number;
	/** of `del`, the CPU part (deleted work that ran, not waited) */
	del_cpu: number;
	after: number;
	clamped: boolean;
} {
	let cpu = 0;
	let wait = 0;
	let del_cpu = 0;
	let del_wait = 0;
	for (const s of set) {
		if (s.kind === 'unread-work') {
			if (s.wait) del_wait += s.ms;
			else del_cpu += s.ms;
		} else if (s.wait) wait += s.ms;
		else cpu += s.ms;
	}
	let clamped = false;
	const cap = (a: number, b: number, limit: number | undefined): [number, number] => {
		if (limit === undefined || !(limit >= 0) || a + b <= limit) return [a, b];
		clamped = true;
		const k = limit / (a + b);
		return [a * k, b * k];
	};
	[wait, del_wait] = cap(wait, del_wait, caps.wait);
	[cpu, del_cpu] = cap(cpu, del_cpu, caps.cpu);
	const del = del_cpu + del_wait;
	let total = cpu + wait + del;
	if (total > now * 0.97) {
		total = now * 0.97;
		clamped = true;
	}
	return { cpu, wait, del, del_cpu, after: now - total, clamped };
}
