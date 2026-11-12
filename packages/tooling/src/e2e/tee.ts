// The suite's served app, its output both shown and kept: `node tee.ts` runs the command in
// OGYGIA_E2E_SERVE_COMMAND in a shell, passes its output through, and appends it to the suite's
// server log (./server-log.ts), which it starts empty. A signal to this process goes to the command.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { append_server_log, server_log } from './server-log.ts';

const command = process.env.OGYGIA_E2E_SERVE_COMMAND;
if (!command) throw new Error('[e2e] tee.ts: OGYGIA_E2E_SERVE_COMMAND is not set');
const log = server_log();
if (log !== undefined) {
	mkdirSync(dirname(log), { recursive: true });
	writeFileSync(log, '');
}
const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d: Buffer) => {
	process.stdout.write(d);
	append_server_log(d);
});
child.stderr.on('data', (d: Buffer) => {
	process.stderr.write(d);
	append_server_log(d);
});
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
	process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
