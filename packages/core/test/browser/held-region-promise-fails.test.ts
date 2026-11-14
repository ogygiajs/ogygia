import PromiseRegionAwait from '../../src/PromiseRegionAwait.svelte';
import { held_promise_failure_suite } from './_held-promise-fails.ts';

held_promise_failure_suite(PromiseRegionAwait);
