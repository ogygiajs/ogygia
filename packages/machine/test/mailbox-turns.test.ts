// A mailbox's turns at their edges: what is queued when the owner closes, an asker of a handler
// that rejects later, and a handler's returns that come back while it holds the turn or after it
// ended. Real timers, in node and in a real browser.
import { describe, expect, it } from 'vitest';
import { mailbox, scope, STALE, type Turn } from '../src/index.ts';

const later = <T>(value: T, ms = 1) => new Promise<T>((r) => setTimeout(() => r(value), ms));

function gate() {
	let open!: () => void;
	const opened = new Promise<void>((r) => (open = r));
	return { opened, open };
}

describe('mailbox turns', () => {
	it('an event still queued when the owner closes never runs, though the turn ahead of it ends after', async () => {
		const life = scope();
		const box = mailbox(life);
		const seen: string[] = [];
		const g = gate();
		const a = box.ask(async () => {
			await g.opened;
			seen.push('a');
		});
		box.post(() => seen.push('queued'));
		life.close();
		g.open();
		await a;
		await later(null, 5);
		expect(seen).toEqual(['a']);
	});

	it('an asker hears a handler that rejects after its turn began, and the box goes on', async () => {
		const box = mailbox(scope());
		await expect(
			box.ask(async () => {
				await later(null);
				throw new Error('late');
			})
		).rejects.toThrow('late');
		const seen: string[] = [];
		box.post(() => seen.push('next'));
		expect(seen).toEqual(['next']);
	});

	it('a handler back in its turn from one wait takes its other wait’s return at once, not behind itself', async () => {
		const box = mailbox(scope());
		const out = await box.ask(async (turn: Turn) => {
			const first = turn.wait(later('one', 1));
			const second = turn.wait(later('two', 10));
			const a = await first;
			// (a plain await here keeps the turn while the second wait comes back)
			const b = await second;
			return [a, b];
		});
		expect(out).toEqual(['one', 'two']);
	});

	it('a handler that ended while its return was queued takes no turn: the next event still runs', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		const back = gate();
		const end = gate();
		const hold = gate();
		box.post((turn) => {
			void turn.wait(back.opened).then((v) => seen.push(v === STALE ? 'stale' : 'stray back'));
			return end.opened;
		});
		const b = box.ask(async () => {
			await hold.opened;
			seen.push('b');
		});
		back.open();
		await later(null);
		end.open();
		await later(null);
		hold.open();
		await b;
		await later(null);
		box.post(() => seen.push('c'));
		expect(seen).toEqual(['b', 'stray back', 'c']);
	});
});
