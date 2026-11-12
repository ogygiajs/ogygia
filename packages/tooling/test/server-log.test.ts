// The suite's server log (src/e2e/server-log.ts): what a server appended while a test ran, and the
// server rules it said there, each once.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	SERVER_LOG_ENV,
	append_server_log,
	said_rules,
	server_log_since,
	server_log_size
} from '../src/e2e/server-log.ts';

afterEach(() => {
	delete process.env[SERVER_LOG_ENV];
});

describe('the server log', () => {
	it('a test reads what was appended after it started', () => {
		process.env[SERVER_LOG_ENV] = join(mkdtempSync(join(tmpdir(), 'og-log-')), 'a', 'server.log');
		expect(server_log_size()).toBe(0);
		append_server_log('before\n');
		const from = server_log_size();
		append_server_log('during\n');
		expect(server_log_since(from)).toBe('during\n');
	});

	it('outside a suite there is no log, and appending is nothing', () => {
		append_server_log('x');
		expect(server_log_size()).toBe(0);
		expect(server_log_since(0)).toBe('');
	});

	it('reads each rule a server said, with its detail decoded, once', () => {
		const text = `[ogygia] https://ogygiajs.dev/e/rule_capability_not_path?detail=.%2F__ogygia__%3B+.%2F__ogygia__
[ogygia] https://ogygiajs.dev/e/secret_missing
[ogygia] https://ogygiajs.dev/e/rule_request_scope_open
[ogygia] https://ogygiajs.dev/e/rule_request_scope_open`;
		expect(said_rules(text)).toEqual([
			'rule_capability_not_path: ./__ogygia__; ./__ogygia__',
			'rule_request_scope_open'
		]);
	});
});
