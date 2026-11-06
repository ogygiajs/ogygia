/**
 * A Windows-style "determinate-ish" progress: crawls forward fast at first, eases toward 95% with the
 * occasional burst, then snaps to 100% when the real work finishes. There is no true percentage to
 * report — the profile endpoint just works until it's done — so this is a timed illusion, the standard
 * "something is happening" reassurance bar. Call `start()` when the request goes out, `finish()` when
 * it resolves (it awaits one paint at 100% before returning), `fail()` on error.
 */
export class FakeProgress {
	#value = $state(0);
	#running = $state(false);
	#timer: ReturnType<typeof setInterval> | undefined;

	get value(): number {
		return this.#value;
	}

	get running(): boolean {
		return this.#running;
	}

	start(): void {
		clearInterval(this.#timer);
		this.#value = 0;
		this.#running = true;
		this.#timer = setInterval(() => this.#tick(), 170);
	}

	async finish(): Promise<void> {
		clearInterval(this.#timer);
		this.#value = 100;
		// let the 100% frame paint before the caller swaps the view
		await new Promise((r) => setTimeout(r, 420));
		this.#running = false;
	}

	fail(): void {
		clearInterval(this.#timer);
		this.#running = false;
		this.#value = 0;
	}

	#tick(): void {
		if (this.#value >= 95) return;
		const gap = 95 - this.#value;
		// base easing (fast when far from 95, slow as it nears) + an occasional "then a lot" jump
		const burst = Math.random() < 0.18 ? gap * 0.14 : 0;
		this.#value = Math.min(95, this.#value + gap * 0.045 + burst + 0.5);
	}
}
