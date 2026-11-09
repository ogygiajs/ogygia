// A Node process with nothing else to do: one put whose first try fails, then a wait before the
// second. Prints how the put ended; the process must not exit before it does.
import { outbox, policy } from '../../src/index.ts';

let tries = 0;
const box = outbox({
	send: async () => {
		if (++tries === 1) throw new Error('once');
	},
	retry: policy({ attempts: 2, backoff: 200, jitter: 0, deadline: 5_000 }),
	giveUp: () => console.log('gave up')
});
void box.put(1).then((done) => console.log(`done ${done} after ${tries} tries`));
