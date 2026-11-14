import { machine, type Machine } from '@ogygia/machine';
import type { Compiler } from '../driver.ts';
import { OgygiaError } from '../messages.ts';

type SessionStates = { created: {}; configured: {}; resolved: { compiler: Compiler } };
const SESSION_STEPS = {
	created: ['configured', 'resolved'],
	configured: ['configured', 'resolved'],
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
