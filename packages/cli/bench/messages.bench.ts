// The CLI's messages, worded as the terminal prints them: each bisect server failure (a held port,
// a server that exits on boot with its output, one that never answers) and its page's details.
import { bench } from '@bench/heisenbench/bench';
import { CLI_ERRORS } from '../src/messages.ts';

const OUTPUT = Array.from({ length: 40 }, (_, i) => `line ${i} of the server's output`).join('\n');

bench(
	"cli messages: the bisect server's failures, worded with their details",
	({ commits }) => {
		const { cli_server_port_busy, cli_server_exited_early, cli_server_not_ready } = CLI_ERRORS;
		let n = 0;
		for (let i = 0; i < commits; i++) {
			const url = `http://127.0.0.1:${3000 + i}/`;
			n += cli_server_port_busy.text({ url, port: 3000 + i, ms: 60_000 }).length;
			n += cli_server_exited_early.text({
				cmd: 'node build',
				how: `code ${i % 3}`,
				output: i % 2 === 0 ? OUTPUT : ''
			}).length;
			n += cli_server_not_ready.text({ url, ms: 60_000, output: OUTPUT }).length;
		}
		return (
			n +
			cli_server_port_busy.details().length +
			cli_server_exited_early.details().length +
			cli_server_not_ready.details().length
		);
	},
	{ setup: () => ({ commits: 12 }), scale: (_ctx, k) => ({ commits: 12 * k }) }
);
