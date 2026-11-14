import PromiseRegion from '../../src/PromiseRegion.svelte';
import { held_promise_failure_suite } from '../browser/_held-promise-fails.ts';

held_promise_failure_suite(PromiseRegion);
