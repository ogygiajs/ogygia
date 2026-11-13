/**
 * A Windows-style "determinate-ish" progress: crawls forward fast at first, eases toward 95% with the
 * occasional burst, then snaps to 100% when the real work finishes. There is no true percentage to
 * report — the profile endpoint just works until it's done — so this is a timed illusion, the standard
 * "something is happening" reassurance bar. Call `start()` when the request goes out, `finish()` when
 * it resolves (it awaits one paint at 100% before returning), `fail()` on error.
 *
 * Its timers belong to it (a scope): the view that shows it closes it when it unmounts, and every
 * timer goes with it, mid-run or not.
 */
import { scope, STALE, type Scope } from '@ogygia/machine';

export class FakeProgress {
	#value = $state(0);
	#running = $state(false);
	readonly #owner = scope();
	/** The run's ticking, while one runs. */
	#run: Scope | null = null;

	get value(): number {
		return this.#value;
	}

	get running(): boolean {
		return this.#running;
	}

	start(): void {
		this.#stop();
		if (this.#owner.closed) return;
		this.#value = 0;
		this.#running = true;
		this.#run = this.#owner.child();
		this.#run.every(() => this.#tick(), 170);
	}

	async finish(): Promise<void> {
		this.#stop();
		this.#value = 100;
		// let the 100% frame paint before the caller swaps the view
		const owner = this.#owner;
		const painted = await owner.task(() => new Promise<void>((r) => owner.timeout(r, 420)));
		if (painted !== STALE) this.#running = false;
	}

	fail(): void {
		this.#stop();
		this.#running = false;
		this.#value = 0;
	}

	/** Lets go of every timer, for good (the view unmounted). */
	close(): void {
		this.#owner.close();
	}

	#stop(): void {
		this.#run?.close();
		this.#run = null;
	}

	#tick(): void {
		if (this.#value >= 95) return;
		const gap = 95 - this.#value;
		// base easing (fast when far from 95, slow as it nears) + an occasional "then a lot" jump
		const burst = Math.random() < 0.18 ? gap * 0.14 : 0;
		this.#value = Math.min(95, this.#value + gap * 0.045 + burst + 0.5);
	}
}
