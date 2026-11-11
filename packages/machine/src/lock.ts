/** Proof of holding a lock. Each `take` or `acquire` gets a new one. */
export type LockToken = number & { readonly __lock_token: true };

export interface Lock {
	/** Someone holds it. */
	readonly held: boolean;
	/** Takes it now, or `null` when it is held. */
	take(): LockToken | null;
	/** Takes it as soon as it is free, in the order asked. Rejects with the signal's reason once
	 *  `signal` aborts before its turn (it never gets the lock then). */
	acquire(signal?: AbortSignal): Promise<LockToken>;
	/** Frees it, only for the token holding it: `false` (and nothing changes) for any other. The
	 *  next waiter, if any, gets it straight away. */
	free(token: LockToken): boolean;
	/** Takes it from whoever holds it (a stuck owner, a reset): their token stops working. Returns
	 *  the new token. Waiters keep their place behind it. */
	seize(): LockToken;
}

type Waiter = {
	resolve: (token: LockToken) => void;
	signal: AbortSignal | undefined;
	on_abort: (() => void) | null;
};

class Owned implements Lock {
	#owner = 0;
	#minted = 0;
	#queue: Waiter[] = [];

	get held(): boolean {
		return this.#owner !== 0;
	}

	take(): LockToken | null {
		if (this.#owner !== 0) return null;
		return (this.#owner = ++this.#minted) as LockToken;
	}

	acquire(signal?: AbortSignal): Promise<LockToken> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		const token = this.take();
		if (token !== null) return Promise.resolve(token);
		return new Promise((resolve, reject) => {
			const waiter: Waiter = { resolve, signal, on_abort: null };
			if (signal !== undefined) {
				waiter.on_abort = () => {
					const at = this.#queue.indexOf(waiter);
					if (at !== -1) this.#queue.splice(at, 1);
					reject(signal.reason);
				};
				signal.addEventListener('abort', waiter.on_abort, { once: true });
			}
			this.#queue.push(waiter);
		});
	}

	free(token: LockToken): boolean {
		if (this.#owner === 0 || token !== this.#owner) return false;
		const next = this.#queue.shift();
		if (next === undefined) {
			this.#owner = 0;
			return true;
		}
		if (next.on_abort !== null) next.signal?.removeEventListener('abort', next.on_abort);
		next.resolve((this.#owner = ++this.#minted) as LockToken);
		return true;
	}

	seize(): LockToken {
		return (this.#owner = ++this.#minted) as LockToken;
	}
}

/**
 * A new, free lock with an owner: only the token that took it can free it.
 *
 *   const recorder = lock();
 *   const token = recorder.take();          // null while someone holds it
 *   if (token !== null) try { ... } finally { recorder.free(token); }
 *
 *   const token = await recorder.acquire(signal); // waits its turn, first come first served
 *
 * A late `free` from an owner that already lost the lock (a reset, a timeout) is refused, so it
 * can never free the lock out from under whoever holds it now.
 */
export function lock(): Lock {
	return new Owned();
}
