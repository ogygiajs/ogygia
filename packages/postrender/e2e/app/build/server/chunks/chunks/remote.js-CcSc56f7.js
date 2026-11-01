import { k as stringify_remote_arg, e as create_remote_key, n as noop, H as HttpError, S as SvelteKitError } from './shared.js-iXTe6R8-.js';
import { z as get_request_store, w as with_request_store, v as error, c as handle_error_and_jsonify } from './utils.js-Ca9I6N5J.js';

// ../../../../node_modules/.pnpm/@sveltejs+kit@2.70.2_@opentelemetry+api@1.9.1_@sveltejs+vite-plugin-svelte@7.2.0_svelte_2ce614995eed84b42ffc972a2513643c/node_modules/@sveltejs/kit/src/runtime/app/server/remote/shared.js
/** @import { RequestEvent } from '@sveltejs/kit' */
/** @import { ServerHooks, MaybePromise, RequestState, RemoteInternals, RequestStore, RemoteLiveQueryUserFunctionReturnType } from 'types' */
/**
* @param {any} validate_or_fn
* @param {((arg?: any) => any) | undefined} [maybe_fn]
* @returns {(arg?: any) => MaybePromise<any>}
*/
function create_validator(validate_or_fn, maybe_fn) {
	if (!maybe_fn) return (arg) => {
		if (arg !== void 0) error(400, "Bad Request");
	};
	if (validate_or_fn === "unchecked") return (arg) => arg;
	if ("~standard" in validate_or_fn) return async (arg) => {
		const { event, state } = get_request_store();
		const result = await validate_or_fn["~standard"].validate(arg);
		if (result.issues) error(400, await state.handleValidationError({
			issues: result.issues,
			event
		}));
		return result.value;
	};
	throw new Error("Invalid validator passed to remote function. Expected \"unchecked\" or a Standard Schema (https://standardschema.dev)");
}
/**
* In case of a single remote function call, just returns the result.
*
* In case of a full page reload, returns the response for a remote function call,
* either from the cache or by invoking the function.
* Also saves an uneval'ed version of the result for later HTML inlining for hydration.
*
* @template {MaybePromise<any>} T
* @param {RemoteInternals} internals
* @param {string} payload — the stringified raw argument (i.e. the cache key the client will use)
* @param {RequestState} state
* @param {() => Promise<T>} get_result
* @returns {Promise<T>}
*/
async function get_response(internals, payload, state, get_result) {
	await 0;
	const cache = get_cache(internals, state);
	if (!state.is_in_remote_query) get_implicit_lookup(internals, state)[payload] = get_result;
	return cache[payload] ??= get_result();
}
/**
* @param {RequestEvent} event
* @param {RequestState} state
* @param {boolean} allow_cookies
* @returns {RequestStore}
*/
function derive_remote_function_event(event, state, allow_cookies) {
	return {
		event: {
			...event,
			setHeaders: () => {
				throw new Error("setHeaders is not allowed in remote functions");
			},
			cookies: {
				...event.cookies,
				set: (name, value, opts) => {
					throw new Error("Cannot set cookies in `query` or `prerender` functions");
				},
				delete: (name, opts) => {
					throw new Error("Cannot delete cookies in `query` or `prerender` functions");
				}
			}
		},
		state: {
			...state,
			is_in_remote_function: true
		}
	};
}
/**
* Like `with_event` but removes things from `event` you cannot see/call in remote functions, such as `setHeaders`.
* @template T
* @param {RequestEvent} event
* @param {RequestState} state
* @param {boolean} allow_cookies
* @param {() => any} get_input
* @param {(arg?: any) => T} fn
*/
async function run_remote_function(event, state, allow_cookies, get_input, fn) {
	const store = derive_remote_function_event(event, state);
	const input = await with_request_store(store, get_input);
	return with_request_store(store, () => fn(input));
}
/**
* Like `with_event` but removes things from `event` you cannot see/call in remote functions, such as `setHeaders`.
* @template T
* @param {RequestEvent} event
* @param {RequestState} state
* @param {boolean} allow_cookies
* @param {() => any} get_input
* @param {(arg?: any) => RemoteLiveQueryUserFunctionReturnType<T>} fn
* @param {string} name
*/
async function* run_remote_generator(event, state, allow_cookies, get_input, fn, name) {
	const store = derive_remote_function_event(event, state);
	const input = await with_request_store(store, get_input);
	const iterator = to_iterator(await with_request_store(store, () => fn(input)), name);
	let done = false;
	try {
		while (true) {
			const result = await with_request_store(store, () => iterator.next());
			if (result.done) {
				done = true;
				return result.value;
			}
			yield result.value;
		}
	} finally {
		if (!done && typeof iterator.return === "function") await with_request_store(store, () => iterator.return?.(void 0));
	}
}
/**
* @template T
* @param {Awaited<RemoteLiveQueryUserFunctionReturnType<T>>} source
* @param {string} name
* @returns {Iterator<T> | AsyncIterator<T>}
*/
function to_iterator(source, name) {
	if ("next" in source && typeof source.next === "function") return source;
	if (Symbol.asyncIterator in source && typeof source[Symbol.asyncIterator] === "function") return source[Symbol.asyncIterator]();
	if (Symbol.iterator in source && typeof source[Symbol.iterator] === "function") return source[Symbol.iterator]();
	throw new Error(`query.live '${name}' must return an Iterator, Iterable, AsyncIterator or AsyncIterable`);
}
/**
* Note that `state` is deliberately not optional: resources that capture the request
* state at creation must pass it explicitly, because reading it from the request store
* at call time is only equivalent on runtimes with `AsyncLocalStorage` support.
* Callers without a captured state (such as the module-level `form` instance getters)
* should pass `get_request_store().state` themselves.
* @param {RemoteInternals} internals
* @param {RequestState} state
*/
function get_cache(internals, state) {
	let cache = state.remote.data?.get(internals);
	if (cache === void 0) {
		cache = {};
		(state.remote.data ??= /* @__PURE__ */ new Map()).set(internals, cache);
	}
	return cache;
}
/**
* @param {RemoteInternals} internals
* @param {RequestState} state
*/
function get_implicit_lookup(internals, state) {
	let cache = state.remote.implicit?.get(internals);
	if (cache === void 0) {
		cache = {};
		(state.remote.implicit ??= /* @__PURE__ */ new Map()).set(internals, cache);
	}
	return cache;
}
// ../../../../node_modules/.pnpm/@sveltejs+kit@2.70.2_@opentelemetry+api@1.9.1_@sveltejs+vite-plugin-svelte@7.2.0_svelte_2ce614995eed84b42ffc972a2513643c/node_modules/@sveltejs/kit/src/utils/shared-iterator.js
/**
* A pull-style async iterator that fans out a single stream of values to
* multiple `for await (...)` consumers. Each subscriber gets its own
* `AsyncGenerator` whose `.next()` resolves whenever a value is pushed via
* `push(value)`. Multiple consumers see the same values without each one
* driving an independent underlying source.
*
* Backpressure is **latest-wins**: if values arrive faster than a particular
* consumer drains its iterator, only the most-recently-pushed value is kept
* pending for that subscriber. Earlier undrained values are dropped. This is
* appropriate for live data streams (reactive state replication), not for
* event logs where every value must be delivered.
*
* Lifecycle hooks are exposed via the constructor:
*
*   - `start()` is called when the subscriber count transitions
*     from 0 to 1 (e.g. to start a pump pulling from a real source).
*   - `stop()` is called when the subscriber count transitions
*     from non-zero back to 0 (e.g. to tear down that pump).
*
* Either hook may be omitted.
*
* The owner is responsible for calling `push(value)` to broadcast values,
* `done()` to signal natural completion to all subscribers, and `fail(error)`
* to broadcast a terminal error. After `done()` or `fail()`, the iterator
* rejects further `subscribe()` calls with the terminal state appropriately.
*
* @template T
*/
var SharedIterator = class {
	/**
	* @typedef {object} Subscriber
	* @property {{ value: any } | null} pending
	* @property {{ error: unknown } | null} pending_error
	* @property {boolean} finished
	* @property {((result: IteratorResult<any, void>) => void) | null} waiting_resolve
	* @property {((reason: unknown) => void) | null} waiting_reject
	*/
	/** @type {Set<Subscriber>} */
	#subscribers = /* @__PURE__ */ new Set();
	/** @type {((instance: SharedIterator<T>) => (() => void)) | undefined} */
	#start = void 0;
	/** @type {(() => void) | undefined} */
	#stop = void 0;
	/** Once `done()` or `fail()` has been broadcast, no new values are accepted. */
	#closed = false;
	/** @type {unknown} */
	#terminal_error = void 0;
	/** Whether `done()` or `fail()` has been broadcast. */
	get closed() {
		return this.#closed;
	}
	/**
	* @param {(instance: SharedIterator<T>) => (() => void)} [start]
	*/
	constructor(start) {
		this.#start = start;
	}
	/** @param {T} value */
	push(value) {
		if (this.#closed) return;
		for (const subscriber of this.#subscribers) if (subscriber.waiting_resolve) {
			const resolve = subscriber.waiting_resolve;
			subscriber.waiting_resolve = null;
			subscriber.waiting_reject = null;
			resolve({
				value,
				done: false
			});
		} else subscriber.pending = { value };
	}
	/**
	* Signal natural completion to all current subscribers, and to any future
	* subscriber (which will receive an immediately-done iterator).
	*/
	done() {
		if (this.#closed) return;
		this.#closed = true;
		for (const subscriber of this.#subscribers) {
			subscriber.finished = true;
			if (subscriber.waiting_resolve) {
				const resolve = subscriber.waiting_resolve;
				subscriber.waiting_resolve = null;
				subscriber.waiting_reject = null;
				resolve({
					value: void 0,
					done: true
				});
			}
		}
		this.#subscribers.clear();
	}
	/**
	* Broadcast a terminal error. All current subscribers will reject their
	* next `.next()` call with `error`. Future subscribers will also reject
	* their first `.next()`.
	*
	* @param {unknown} error
	*/
	fail(error) {
		if (this.#closed) return;
		this.#closed = true;
		this.#terminal_error = error;
		for (const subscriber of this.#subscribers) {
			subscriber.finished = true;
			if (subscriber.waiting_reject) {
				const reject = subscriber.waiting_reject;
				subscriber.waiting_resolve = null;
				subscriber.waiting_reject = null;
				reject(error);
			} else subscriber.pending_error = { error };
		}
		this.#subscribers.clear();
	}
	/**
	* Subscribe to the shared stream. Returns an `AsyncGenerator<T>` that
	* yields every value pushed after this call (and, if `initial_value` is
	* provided, that value as the first yield).
	*
	* @param {{ initial_value?: { value: T } }} [options]
	*   `initial_value` lets the caller seed the iterator with a synchronously-
	*   available current value before any new pushes arrive (e.g. the
	*   "last-seen value" of a reactive resource). Pass it wrapped in an
	*   object so `undefined` can be distinguished from "no initial value".
	* @returns {AsyncGenerator<T, void, void>}
	*/
	subscribe(options) {
		/** @type {Subscriber} */
		const subscriber = {
			pending: options?.initial_value ? { value: options.initial_value.value } : null,
			pending_error: this.#closed && this.#terminal_error !== void 0 ? { error: this.#terminal_error } : null,
			finished: this.#closed && this.#terminal_error === void 0,
			waiting_resolve: null,
			waiting_reject: null
		};
		if (!subscriber.finished && subscriber.pending_error === null) this.#subscribers.add(subscriber);
		if (!this.#closed) this.#stop ??= this.#start?.(this);
		const unsubscribe = () => {
			subscriber.finished = true;
			if (this.#subscribers.delete(subscriber) && this.#subscribers.size === 0) this.#stop?.();
		};
		/** @type {AsyncGenerator<T, void, void>} */
		const iterator = {
			next() {
				if (subscriber.pending_error) {
					const { error } = subscriber.pending_error;
					subscriber.pending_error = null;
					unsubscribe();
					return Promise.reject(error);
				}
				if (subscriber.pending) {
					const { value } = subscriber.pending;
					subscriber.pending = null;
					return Promise.resolve({
						value,
						done: false
					});
				}
				if (subscriber.finished) return Promise.resolve({
					value: void 0,
					done: true
				});
				return new Promise((resolve, reject) => {
					subscriber.waiting_resolve = resolve;
					subscriber.waiting_reject = reject;
				});
			},
			return(value) {
				unsubscribe();
				if (subscriber.waiting_resolve) {
					const resolve = subscriber.waiting_resolve;
					subscriber.waiting_resolve = null;
					subscriber.waiting_reject = null;
					resolve({
						value: void 0,
						done: true
					});
				}
				return Promise.resolve({
					value,
					done: true
				});
			},
			throw(error) {
				unsubscribe();
				if (subscriber.waiting_reject) {
					const reject = subscriber.waiting_reject;
					subscriber.waiting_resolve = null;
					subscriber.waiting_reject = null;
					reject(error);
				}
				return Promise.reject(error);
			},
			[Symbol.asyncIterator]() {
				return iterator;
			}
		};
		return iterator;
	}
};
// ../../../../node_modules/.pnpm/@sveltejs+kit@2.70.2_@opentelemetry+api@1.9.1_@sveltejs+vite-plugin-svelte@7.2.0_svelte_2ce614995eed84b42ffc972a2513643c/node_modules/@sveltejs/kit/src/runtime/app/server/remote/query.js
/** @import { RemoteLiveQuery, RemoteLiveQueryFunction, RemoteQuery, RemoteQueryFunction, RequestEvent } from '@sveltejs/kit' */
/** @import { RemoteInternals, MaybePromise, RequestState, RemoteQueryLiveInternals, RemoteQueryBatchInternals, RemoteQueryInternals, RemoteLiveQueryUserFunctionReturnType } from 'types' */
/** @import { StandardSchemaV1 } from '@standard-schema/spec' */
/**
* Creates a remote query. When called from the browser, the function will be invoked on the server via a `fetch` call.
*
* See [Remote functions](https://svelte.dev/docs/kit/remote-functions#query) for full documentation.
*
* @template Output
* @overload
* @param {() => MaybePromise<Output>} fn
* @returns {RemoteQueryFunction<void, Output>}
* @since 2.27
*/
/**
* Creates a remote query. When called from the browser, the function will be invoked on the server via a `fetch` call.
*
* See [Remote functions](https://svelte.dev/docs/kit/remote-functions#query) for full documentation.
*
* @template Input
* @template Output
* @overload
* @param {'unchecked'} validate
* @param {(arg: Input) => MaybePromise<Output>} fn
* @returns {RemoteQueryFunction<Input, Output>}
* @since 2.27
*/
/**
* Creates a remote query. When called from the browser, the function will be invoked on the server via a `fetch` call.
*
* See [Remote functions](https://svelte.dev/docs/kit/remote-functions#query) for full documentation.
*
* @template {StandardSchemaV1} Schema
* @template Output
* @overload
* @param {Schema} schema
* @param {(arg: StandardSchemaV1.InferOutput<Schema>) => MaybePromise<Output>} fn
* @returns {RemoteQueryFunction<StandardSchemaV1.InferInput<Schema>, Output, StandardSchemaV1.InferOutput<Schema>>}
* @since 2.27
*/
/**
* @template Input
* @template Output
* @param {any} validate_or_fn
* @param {(args?: Input) => MaybePromise<Output>} [maybe_fn]
* @returns {RemoteQueryFunction<Input, Output>}
* @since 2.27
*/
/*@__NO_SIDE_EFFECTS__*/
function query(validate_or_fn, maybe_fn) {
	/** @type {(arg?: Input) => Output} */
	const fn = maybe_fn ?? validate_or_fn;
	/** @type {(arg?: any) => MaybePromise<Input>} */
	const validate = create_validator(validate_or_fn, maybe_fn);
	/** @type {RemoteQueryInternals} */
	const __ = {
		type: "query",
		id: "",
		name: "",
		validate,
		bind(payload, validated_arg) {
			const { event, state } = get_request_store();
			return create_query_resource(__, payload, event, state, () => run_remote_function(event, {
				...state,
				is_in_remote_query: true
			}, false, () => validated_arg, fn));
		}
	};
	/** @type {RemoteQueryFunction<Input, Output> & { __: RemoteQueryInternals }} */
	const wrapper = (arg) => {
		const { event, state } = get_request_store();
		const payload = stringify_remote_arg(arg, state.transport);
		return create_query_resource(__, payload, event, state, () => run_remote_function(event, {
			...state,
			is_in_remote_query: true
		}, false, () => validate(arg), fn));
	};
	Object.defineProperty(wrapper, "__", { value: __ });
	return wrapper;
}
/**
* Creates a live remote query. When called from the browser, the function will be invoked on the server via a streaming `fetch` call.
*
* See [Remote functions](https://svelte.dev/docs/kit/remote-functions#query.live) for full documentation.
*
* @template Output
* @overload
* @param {(arg: void) => RemoteLiveQueryUserFunctionReturnType<Output>} fn
* @returns {RemoteLiveQueryFunction<void, Output>}
*/
/**
* @template Input
* @template Output
* @overload
* @param {'unchecked'} validate
* @param {(arg: Input) => RemoteLiveQueryUserFunctionReturnType<Output>} fn
* @returns {RemoteLiveQueryFunction<Input, Output>}
*/
/**
* @template {StandardSchemaV1} Schema
* @template Output
* @overload
* @param {Schema} schema
* @param {(arg: StandardSchemaV1.InferOutput<Schema>) => RemoteLiveQueryUserFunctionReturnType<Output>} fn
* @returns {RemoteLiveQueryFunction<StandardSchemaV1.InferInput<Schema>, Output, StandardSchemaV1.InferOutput<Schema>>}
*/
/**
* @template Input
* @template Output
* @param {any} validate_or_fn
* @param {(args: Input) => RemoteLiveQueryUserFunctionReturnType<Output>} [maybe_fn]
* @returns {RemoteLiveQueryFunction<Input, Output>}
*/
/*@__NO_SIDE_EFFECTS__*/
function live(validate_or_fn, maybe_fn) {
	/** @type {(arg: Input) => RemoteLiveQueryUserFunctionReturnType<Output>} */
	const fn = maybe_fn ?? validate_or_fn;
	/** @type {(arg?: any) => MaybePromise<Input>} */
	const validate = create_validator(validate_or_fn, maybe_fn);
	/**
	* @param {any} event
	* @param {any} state
	* @param {any} get_input
	*/
	const run = (event, state, get_input) => run_remote_generator(event, {
		...state,
		is_in_remote_query: true
	}, false, get_input, fn, __.name);
	/** @type {RemoteQueryLiveInternals} */
	const __ = {
		type: "query_live",
		id: "",
		name: "",
		run: (event, state, arg) => run(event, state, () => validate(arg)),
		validate,
		bind(payload, validated_arg) {
			const { event, state } = get_request_store();
			return create_live_query_resource(__, payload, event, state, () => run(event, state, () => validated_arg));
		}
	};
	/** @type {RemoteLiveQueryFunction<Input, Output> & { __: RemoteQueryLiveInternals }} */
	const wrapper = (arg) => {
		const { event, state } = get_request_store();
		const payload = stringify_remote_arg(arg, state.transport);
		return create_live_query_resource(__, payload, event, state, () => run(event, state, () => validate(arg)));
	};
	Object.defineProperty(wrapper, "__", { value: __ });
	return wrapper;
}
/**
* Creates a batch query function that collects multiple calls and executes them in a single request
*
* See [Remote functions](https://svelte.dev/docs/kit/remote-functions#query.batch) for full documentation.
*
* @template Input
* @template Output
* @overload
* @param {'unchecked'} validate
* @param {(args: Input[]) => MaybePromise<(arg: Input, idx: number) => Output>} fn
* @returns {RemoteQueryFunction<Input, Output>}
* @since 2.35
*/
/**
* Creates a batch query function that collects multiple calls and executes them in a single request
*
* See [Remote functions](https://svelte.dev/docs/kit/remote-functions#query.batch) for full documentation.
*
* @template {StandardSchemaV1} Schema
* @template Output
* @overload
* @param {Schema} schema
* @param {(args: StandardSchemaV1.InferOutput<Schema>[]) => MaybePromise<(arg: StandardSchemaV1.InferOutput<Schema>, idx: number) => Output>} fn
* @returns {RemoteQueryFunction<StandardSchemaV1.InferInput<Schema>, Output, StandardSchemaV1.InferOutput<Schema>>}
* @since 2.35
*/
/**
* @template Input
* @template Output
* @param {any} validate_or_fn
* @param {(args?: Input[]) => MaybePromise<(arg: Input, idx: number) => Output>} [maybe_fn]
* @returns {RemoteQueryFunction<Input, Output>}
* @since 2.35
*/
/*@__NO_SIDE_EFFECTS__*/
function batch(validate_or_fn, maybe_fn) {
	/** @type {(args?: Input[]) => MaybePromise<(arg: Input, idx: number) => Output>} */
	const fn = maybe_fn ?? validate_or_fn;
	/** @type {(arg?: any) => MaybePromise<Input>} */
	const validate = create_validator(validate_or_fn, maybe_fn);
	/**
	* Enqueues a single call into the current batch (creating one if necessary)
	* and returns a promise that resolves with the result for this entry.
	*
	* @param {string} payload — the stringified raw argument (cache key)
	* @param {() => MaybePromise<any>} get_validated — produces the validated argument for this entry
	* @returns {Promise<any>}
	*/
	const enqueue = (payload, get_validated) => {
		const { event, state } = get_request_store();
		return new Promise((resolve, reject) => {
			const batches = state.remote.batches ??= /* @__PURE__ */ new Map();
			let batched = batches.get(__.id);
			if (!batched) {
				batched = /* @__PURE__ */ new Map();
				batches.set(__.id, batched);
			}
			const entry = batched.get(payload);
			if (entry) {
				entry.resolvers.push({
					resolve,
					reject
				});
				return;
			}
			batched.set(payload, {
				get_validated,
				resolvers: [{
					resolve,
					reject
				}]
			});
			if (batched.size > 1) return;
			setTimeout(async () => {
				batches.delete(__.id);
				const entries = Array.from(batched.values());
				try {
					return await run_remote_function(event, {
						...state,
						is_in_remote_query: true
					}, false, async () => Promise.all(entries.map((entry) => entry.get_validated())), async (input) => {
						const get_result = await fn(input);
						for (let i = 0; i < entries.length; i++) try {
							const result = get_result(input[i], i);
							for (const resolver of entries[i].resolvers) resolver.resolve(result);
						} catch (error) {
							for (const resolver of entries[i].resolvers) resolver.reject(error);
						}
					});
				} catch (error) {
					for (const entry of batched.values()) for (const resolver of entry.resolvers) resolver.reject(error);
				}
			}, 0);
		});
	};
	/** @type {RemoteQueryBatchInternals} */
	const __ = {
		type: "query_batch",
		id: "",
		name: "",
		validate,
		run: async (args, options) => {
			const { event, state } = get_request_store();
			return run_remote_function(event, {
				...state,
				is_in_remote_query: true
			}, false, async () => Promise.all(args.map(validate)), async (input) => {
				const get_result = await fn(input);
				return Promise.all(input.map(async (arg, i) => {
					try {
						return {
							type: "result",
							data: get_result(arg, i)
						};
					} catch (error) {
						return {
							type: "error",
							error: await handle_error_and_jsonify(event, state, options, error),
							status: error instanceof HttpError || error instanceof SvelteKitError ? error.status : 500
						};
					}
				}));
			});
		},
		bind(payload, validated_arg) {
			const { event, state } = get_request_store();
			return create_query_resource(__, payload, event, state, () => enqueue(payload, () => validated_arg));
		}
	};
	/** @type {RemoteQueryFunction<Input, Output> & { __: RemoteQueryBatchInternals }} */
	const wrapper = (arg) => {
		const { event, state } = get_request_store();
		const payload = stringify_remote_arg(arg, state.transport);
		return create_query_resource(__, payload, event, state, () => enqueue(payload, () => validate(arg)));
	};
	Object.defineProperty(wrapper, "__", { value: __ });
	return wrapper;
}
/**
* Include this value in the returned payload...
* @param {RequestEvent} event
* @param {RequestState} state
* @param {RemoteInternals} internals
* @param {string} payload
* @param {() => Promise<any>} fn
*/
function refresh(event, state, internals, payload, fn) {
	if (!internals.id) return;
	if (!event.isRemoteRequest) return;
	const key = create_remote_key(internals.id, payload);
	const promise = fn();
	promise.catch(() => {});
	(state.remote.explicit ??= /* @__PURE__ */ new Map()).set(key, {
		internals,
		promise
	});
}
/**
* @param {RemoteInternals} __
* @param {string} payload — the stringified raw argument (i.e. the cache key the client will use)
* @param {RequestEvent} event
* @param {RequestState} state
* @param {() => Promise<any>} fn
* @returns {RemoteQuery<any>}
*/
function create_query_resource(__, payload, event, state, fn) {
	/** @type {Promise<any> | null} */
	let promise = null;
	const get_promise = () => {
		return promise ??= get_response(__, payload, state, fn);
	};
	const populate_hydratable = () => {
		if (__.id && state.is_in_render) get_promise().catch(noop);
	};
	return {
		/** @type {Promise<any>['catch']} */
		catch(onrejected) {
			return get_promise().catch(onrejected);
		},
		get current() {
			populate_hydratable();
		},
		get error() {
			populate_hydratable();
		},
		/** @type {Promise<any>['finally']} */
		finally(onfinally) {
			return get_promise().finally(onfinally);
		},
		get loading() {
			populate_hydratable();
			return true;
		},
		get ready() {
			populate_hydratable();
			return false;
		},
		refresh() {
			promise = null;
			delete get_cache(__, state)[payload];
			refresh(event, state, __, payload, get_promise);
			return Promise.resolve();
		},
		/** @param {any} value */
		set(value) {
			const p = promise = Promise.resolve(value);
			get_cache(__, state)[payload] = p;
			refresh(event, state, __, payload, () => p);
		},
		run() {
			throw new Error(`\`myQuery().run()\` has been removed — please replace it with \`myQuery()\`. See https://github.com/sveltejs/kit/pull/15779 for more details`);
		},
		/** @type {Promise<any>['then']} */
		then(onfulfilled, onrejected) {
			return get_promise().then(onfulfilled, onrejected);
		},
		withOverride() {
			throw new Error(`Cannot call '${__.name}.withOverride()' on the server`);
		},
		get [Symbol.toStringTag]() {
			return "QueryResource";
		}
	};
}
/**
* @param {RemoteQueryLiveInternals} __
* @param {string} payload — the stringified raw argument (i.e. the cache key the client will use)
* @param {RequestEvent} event
* @param {RequestState} state
* @param {() => AsyncGenerator<any, void, void>} get_generator
* @returns {RemoteLiveQuery<any>}
*/
function create_live_query_resource(__, payload, event, state, get_generator) {
	/** @type {Promise<any> | null} */
	let promise = null;
	const get_first_value = async () => {
		for await (const value of get_generator()) return value;
		throw new Error(`query.live '${__.name}' did not yield a value`);
	};
	const get_promise = () => {
		return promise ??= get_response(__, payload, state, get_first_value);
	};
	const populate_hydratable = () => {
		if (__.id && state.is_in_render) get_promise().catch(noop);
	};
	return {
		/** @type {Promise<any>['catch']} */
		catch(onrejected) {
			return get_promise().catch(onrejected);
		},
		get current() {
			populate_hydratable();
		},
		get error() {
			populate_hydratable();
		},
		/** @type {Promise<any>['finally']} */
		finally(onfinally) {
			return get_promise().finally(onfinally);
		},
		get done() {
			populate_hydratable();
			return false;
		},
		get loading() {
			populate_hydratable();
			return true;
		},
		get ready() {
			populate_hydratable();
			return false;
		},
		get connected() {
			populate_hydratable();
			return false;
		},
		reconnect() {
			promise = null;
			delete get_cache(__, state)[payload];
			refresh(event, state, __, payload, get_promise);
			return Promise.resolve();
		},
		/** @ts-expect-error This method no longer exists */
		run() {
			throw new Error("`.run()` has been removed from live queries. Use `for await (const value of liveQuery())` instead.");
		},
		/** @type {Promise<any>['then']} */
		then(onfulfilled, onrejected) {
			return get_promise().then(onfulfilled, onrejected);
		},
		[Symbol.asyncIterator]() {
			const key = create_remote_key(__.id, payload);
			const cache = state.remote.live_iterators ??= /* @__PURE__ */ new Map();
			let cached = cache.get(key);
			if (!cached) {
				cached = create_shared_live_iterator(event.request.signal, get_generator);
				cache.set(key, cached);
			}
			return cached.subscribe();
		},
		get [Symbol.toStringTag]() {
			return "LiveQueryResource";
		}
	};
}
/**
* Wraps a lazily-created live-query generator so that multiple `for await`
* consumers within the same request share one underlying iteration. The first
* subscriber starts the generator; values are broadcast to all subscribers
* via a `SharedIterator`. When the last subscriber unsubscribes, the generator
* is closed via `generator.return(undefined)`.
*
* If `signal` aborts (typically because the client has disconnected), the
* pump is torn down and any in-flight `next()` calls on consumer iterators
* resolve with `{ done: true }`, so suspended `for await` loops unwind
* cleanly rather than leaking.
*
* @param {AbortSignal} signal
* @param {() => AsyncGenerator<any, void, void>} get_generator
*/
function create_shared_live_iterator(signal, get_generator) {
	return new SharedIterator((instance) => {
		if (signal.aborted) {
			instance.done();
			return noop;
		}
		const generator = get_generator();
		let aborted = false;
		const close = () => {
			aborted = true;
			generator.return().catch(noop);
		};
		signal.addEventListener("abort", () => (close(), instance.done()), { once: true });
		(async () => {
			try {
				while (true) {
					const result = await generator.next();
					if (result.done) {
						instance.done();
						return;
					}
					instance.push(result.value);
				}
			} catch (error) {
				if (!aborted) instance.fail(error);
			} finally {
				close();
			}
		})();
		return close;
	});
}
Object.defineProperty(query, "batch", {
	value: batch,
	enumerable: true
});
Object.defineProperty(query, "live", {
	value: live,
	enumerable: true
});

export { query as q };
//# sourceMappingURL=remote.js-CcSc56f7.js.map
