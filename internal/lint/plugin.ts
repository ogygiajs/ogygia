/**
 * The repo's own lint rules (an oxlint JS plugin, `.oxlintrc.json` → `jsPlugins`). Each rule lives
 * in its own file under `./rules/`, named after it; helpers they share are in `./rules/shared.ts`.
 */

import { compiler_boundary } from './rules/compiler-boundary.ts';
import { dispose_by_close } from './rules/dispose-by-close.ts';
import { fake_timers_whole } from './rules/fake-timers-whole.ts';
import { html_sink } from './rules/html-sink.ts';
import { markup_from_vocabulary } from './rules/markup-from-vocabulary.ts';
import { no_promise_cache } from './rules/no-promise-cache.ts';
import { no_silent_failures } from './rules/no-silent-failures.ts';
import { no_string_concat } from './rules/no-string-concat.ts';
import { one_hash } from './rules/one-hash.ts';
import { one_markup_walk } from './rules/one-markup-walk.ts';
import { owned_effects } from './rules/owned-effects.ts';
import { ports } from './rules/ports.ts';
import { prefer_class_for_state } from './rules/prefer-class-for-state.ts';
import { prefer_dedent } from './rules/prefer-dedent.ts';
import { stale_whole } from './rules/stale-whole.ts';
import { structured_comments } from './rules/structured-comments.ts';
import { tests_read_source } from './rules/tests-read-source.ts';

export default {
	meta: { name: 'ogygia' },
	rules: {
		'html-sink': html_sink,
		'one-markup-walk': one_markup_walk,
		'markup-from-vocabulary': markup_from_vocabulary,
		'one-hash': one_hash,
		'no-promise-cache': no_promise_cache,
		'owned-effects': owned_effects,
		'no-silent-failures': no_silent_failures,
		'stale-whole': stale_whole,
		'no-string-concat': no_string_concat,
		'prefer-dedent': prefer_dedent,
		'structured-comments': structured_comments,
		'compiler-boundary': compiler_boundary,
		'dispose-by-close': dispose_by_close,
		'tests-read-source': tests_read_source,
		'fake-timers-whole': fake_timers_whole,
		'prefer-class-for-state': prefer_class_for_state,
		ports
	}
};
