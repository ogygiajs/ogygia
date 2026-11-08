/** What async work gives back when its owner moved on before the answer arrived: a machine left the
 *  visit, a scope closed, a flight was dropped or its caller left. */
export const STALE: unique symbol = Symbol.for('ogygia.machine.stale');
export type Stale = typeof STALE;
