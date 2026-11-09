// The primitives' simulations (../sim: flights, the outbox, scopes and worlds), in a real browser:
// the runtime holds its downloads, region fetches and visits by the same flights and scopes, and
// the browser's own promise order, AbortSignal and EventTarget are not taken on faith from node's.
// The harness owns the browser's clock too: timers, frames and idle callbacks.
import '../sim/flights.test.ts';
import '../sim/outbox.test.ts';
import '../sim/scope-world.test.ts';
