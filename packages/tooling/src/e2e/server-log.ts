// What the suite's servers print, in one file per suite, so a test can read what they said while it
// ran: the served app's (the webServer, through ./tee.ts) and every server a spec boots
// (`spawn_server`). Its path rides in the environment, so the runner and every worker agree on it.
// A suite runs one test at a time (`workers: 1`), so what was appended between a test's start and
// its end is that test's.
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** The environment variable that names the file. */
export const SERVER_LOG_ENV = 'OGYGIA_E2E_SERVER_LOG';

/** The suite's server log, or undefined outside a suite. */
export const server_log = (): string | undefined => process.env[SERVER_LOG_ENV] || undefined;

/** Appends `chunk` to the suite's server log (none: nothing). */
export function append_server_log(chunk: string | Uint8Array): void {
	const log = server_log();
	if (log === undefined) return;
	try {
		mkdirSync(dirname(log), { recursive: true });
		appendFileSync(log, chunk);
		// oxlint-disable-next-line ogygia/no-silent-failures -- the log is a report, never the test's own work; a server that cannot write it runs on
	} catch {}
}

/** The log's size now (0 when there is none yet). */
export function server_log_size(): number {
	const log = server_log();
	if (log === undefined) return 0;
	try {
		return statSync(log).size;
		// oxlint-disable-next-line ogygia/no-silent-failures -- nothing written yet
	} catch {
		return 0;
	}
}

/** What the log gained since byte `from`. */
export function server_log_since(from: number): string {
	const log = server_log();
	if (log === undefined) return '';
	let fd: number | undefined;
	try {
		const size = statSync(log).size;
		if (size <= from) return '';
		fd = openSync(log, 'r');
		const buf = Buffer.alloc(size - from);
		readSync(fd, buf, 0, buf.length, from);
		return buf.toString('utf8');
		// oxlint-disable-next-line ogygia/no-silent-failures -- no log yet
	} catch {
		return '';
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

const SAID_RULE_G = /ogygiajs\.dev\/e\/(rule_[a-z_]+)(?:\?detail=([^\s"'`]*))?/g;

/** The rules a server said broken in `text` (`code: detail`), each once, in order. */
export function said_rules(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(SAID_RULE_G)) {
		let detail = '';
		try {
			detail = m[2] === undefined ? '' : decodeURIComponent(m[2].replaceAll('+', ' '));
		} catch {
			// oxlint-disable-next-line ogygia/no-silent-failures -- a detail that is not valid encoding is shown as it is
			detail = m[2] ?? '';
		}
		out.add(detail ? `${m[1]}: ${detail}` : m[1]!);
	}
	return [...out];
}
