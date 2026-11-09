/** The dispose symbols as the package and the `using` helpers find them: the built-in ones, or the
 *  registered ones where the runtime has none (WebKit and Safari have no `Symbol.dispose` yet). A
 *  test that calls `x[Symbol.dispose]()` there would call `x[undefined]`. */
export const DISPOSE: typeof Symbol.dispose =
	Symbol.dispose ?? (Symbol.for('Symbol.dispose') as typeof Symbol.dispose);
export const ASYNC_DISPOSE: typeof Symbol.asyncDispose =
	Symbol.asyncDispose ?? (Symbol.for('Symbol.asyncDispose') as typeof Symbol.asyncDispose);
