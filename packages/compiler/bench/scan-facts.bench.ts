// The scan's facts (src/scan-facts.ts): a prescan handing in every file's facts, the
// app-wide folds read once, and a dev session's edits (one that changes no fact, one that does),
// each followed by the folds read again.
import { bench } from '@bench/heisenbench/bench';
import { scan_facts, type FileFacts, type ScanFacts } from '../src/scan-facts.ts';

const N = 500;

const facts_of = (i: number, edit = 0): FileFacts => ({
	crosses_wire: i % 7 === edit,
	transportable: i % 11 === 0,
	specs: i % 3 === 0 ? ['$lib/a', `./m${i + edit}`] : [],
	router: i % 50 === 0
});

function read(s: ScanFacts): number {
	return (
		s.db.get(s.transportable_modules, 'all').size +
		s.db.get(s.wire_crossers, 'all').size +
		s.db.get(s.router_modules, 'all').size +
		s.db.get(s.module_specs, 'all').size
	);
}

bench('scan facts: a prescan of five hundred files, then every fold', () => {
	const s = scan_facts();
	for (let i = 0; i < N; i++) s.set(`/app/src/m${i}.ts`, facts_of(i));
	return read(s) + read(s);
});

bench('scan facts: dev edits, each followed by every fold', () => {
	const s = scan_facts();
	for (let i = 0; i < N; i++) s.set(`/app/src/m${i}.ts`, facts_of(i));
	let n = read(s);
	for (let i = 0; i < 20; i++) {
		s.set(`/app/src/m${i}.ts`, facts_of(i)); // the same facts: nothing moves
		n += read(s);
		s.set(`/app/src/m${i}.ts`, facts_of(i, 1));
		n += read(s);
	}
	s.set('/app/src/m3.ts', null);
	return n + read(s);
});
