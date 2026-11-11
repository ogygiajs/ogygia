/**
 * A Vitest setup file: every test's machine moves, printed when it fails (see `./trace.ts`).
 *
 * @packageDocumentation
 */
import { beforeEach } from 'vitest';
import { trace_on_failure } from './trace.ts';

beforeEach((context) => trace_on_failure(context));
