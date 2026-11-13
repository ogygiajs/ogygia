/**
 * ONE `ogygia()` PLUGIN INSTANCE'S LIFE: made (`created`), its `config` hook ran (`configured`; Vite
 * may run it more than once), the bundler resolved the build (`resolved`). The compiler exists only
 * once resolved, built with that build's context: a hook that needs it earlier is refused
 * (`plugin_session_order`) instead of reading a context that is not there. A second build with the
 * same plugin configures and resolves again, and gets a compiler of its own; a resolve again with no
 * `config` (one plugin shared across a builder's environments) keeps the build under way
 * (test/plugin-session.test.ts, test/second-build.test.ts).
 */
import { machine, type Machine } from '@ogygia/machine';
import type { Compiler } from '../compiler/driver.ts';
import { OgygiaError } from '../compiler/messages.ts';

type SessionStates = { created: {}; configured: {}; resolved: { compiler: Compiler } };
const SESSION_STEPS = {
	created: ['configured', 'resolved'],
	configured: ['configured', 'resolved'],
	// (a second build with the same plugin: `config` again, then a new resolve and a new compiler; a
	// plugin Vite's builder shares across environments: resolved again for the next one, no `config`)
	resolved: ['configured', 'resolved']
} as const;
const SESSION = machine<SessionStates>()({
	name: 'plugin session',
	initial: 'created',
	steps: SESSION_STEPS
});

export type Session = Machine<SessionStates, typeof SESSION_STEPS>;

export function new_session(): Session {
	return SESSION.create();
}

/** The `config` hook ran (again). */
export function configured(session: Session): void {
	session.go('configured');
}

/**
 * The bundler resolved the build: the session's compiler, made with that build's context. `prev` is
 * the compiler a resolve with no `config` since made (a plugin shared across a builder's
 * environments): the new one keeps its build (`Compiler.with_ctx`), else the next leg would start
 * from nothing.
 */
export function resolve(session: Session, make: (prev: Compiler | null) => Compiler): Compiler {
	const now = session.now;
	const compiler = make(now.kind === 'resolved' ? now.compiler : null);
	session.go('resolved', { compiler });
	return compiler;
}

/** The session's compiler, for `hook`: refused before the build is resolved. */
export function compiler_of(session: Session, hook: string): Compiler {
	const now = session.now;
	if (now.kind !== 'resolved') refuse(session, hook);
	return now.compiler;
}

function refuse(session: Session, hook: string): never {
	throw new OgygiaError('plugin_session_order', { hook, state: session.now.kind });
}
