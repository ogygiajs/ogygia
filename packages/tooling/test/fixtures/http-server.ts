// A real HTTP server for the server-lifecycle tests: answers every request with its `id`, and
// shuts down the way the test asks. Run with plain node:
//
//   node http-server.ts port=4100 id=a [exit_delay=2000 | exit_delay=never] [wrap=1] [life=10000]
//
// - `exit_delay`: on SIGTERM it keeps the port and keeps answering this long, then exits (a server
//   draining its connections). `never`: SIGTERM is ignored (only SIGKILL ends it).
// - `wrap=1`: a wrapper process (like a package manager running a script) starts the server as its
//   child and exits at once on SIGTERM, leaving the server to exit on its own time.
// - `life`: it exits on its own after this long whatever happens, so a test run never leaves one.
// - A port it cannot take (EADDRINUSE) is printed to stderr and it exits at once with code 1.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const opts: Record<string, string> = {};
for (const a of process.argv.slice(2)) {
	const eq = a.indexOf('=');
	if (eq > 0) opts[a.slice(0, eq)] = a.slice(eq + 1);
}

setTimeout(() => process.exit(0), Number(opts.life ?? 10_000)).unref();

if (opts.wrap === '1') {
	const args = process.argv.slice(2).filter((a) => !a.startsWith('wrap='));
	const child = spawn(process.execPath, [process.argv[1], ...args], { stdio: 'inherit' });
	process.on('SIGTERM', () => process.exit(0));
	child.on('exit', (code) => process.exit(code ?? 1));
} else {
	const server = createServer((_req, res) => {
		res.setHeader('connection', 'close');
		res.end(opts.id ?? '');
	});
	server.on('error', (error) => {
		process.stderr.write(`could not listen: ${error.message}\n`);
		process.exit(1);
	});
	server.listen(Number(opts.port), '127.0.0.1', () => {
		process.stdout.write(`listening on ${opts.port} as ${opts.id}\n`);
	});
	process.on('SIGTERM', () => {
		if (opts.exit_delay === 'never') return;
		setTimeout(() => process.exit(0), Number(opts.exit_delay ?? 0));
	});
}
