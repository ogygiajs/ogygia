// A posted handler that rejects after its turn began: nobody asked for its value, so the rejection
// is the process's, as a direct call's would be.
import { mailbox, scope } from '../../src/index.ts';

process.on('unhandledRejection', (error) => {
	console.log(`unheard: ${(error as Error).message}`);
});

const box = mailbox(scope());
box.post(async () => {
	await new Promise((r) => setTimeout(r, 1));
	throw new Error('late');
});
