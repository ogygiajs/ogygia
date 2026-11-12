// A transportable class whose module only the island runtime loads (runtime/wire-classes.ts): the
// islands that carry one import its type, never its value, so its module is a lazy chunk of its own
// (e2e/lazy-chunk-retry.spec.ts drops its download). `stamp_text` is the string only that chunk has.
export class RetryStamp {
	label: string;

	constructor(label = '') {
		this.label = label;
	}

	stamp_text(): string {
		return `retry-stamp:${this.label}`;
	}

	static wire = import.meta.og.wire({
		encode: (s: RetryStamp) => s.label,
		decode: (label: string) => new RetryStamp(label)
	});
}
