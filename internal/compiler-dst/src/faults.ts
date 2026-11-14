/**
 * THE DISK AND THE WATCHER FAIL. An editor's save is not atomic, a file can go between a `stat` and
 * the `read` after it, a read can fail outright, and a file watcher can lose an event, send one twice
 * or send a run of them out of order. The compiler cannot see a fault coming; what it owes is to
 * recover once the disk settles and the watcher tells it so (an editor's next save of each file it
 * saw wrong). So the oracle is the dev one: after the faults and that one event per file, the dev
 * server serves what a cold one on the same files serves.
 *
 * `faulty_fs()` puts the disk faults in front of a compile's `Fs`: each is one call's, drawn from a
 * seed, on a file that is there. `watched()` turns a run of saves into the events a faulty watcher
 * delivers.
 */
import type { Fs, MemoryFs } from '../../../packages/compiler/src/index.ts';

/** What one read of a file there can do wrong. */
export type DiskFault = 'read-fails' | 'gone-after-stat' | 'half-written';
export const DISK_FAULTS: readonly DiskFault[] = ['read-fails', 'gone-after-stat', 'half-written'];

/** A disk with faults in front of it, and what they touched. */
export interface FaultyFs extends Fs {
	/** Each file a fault touched (the editor's next save of it is owed). */
	readonly touched: Set<string>;
	/** Every fault taken, in order, as `<fault> <file>`. */
	readonly log: string[];
	/** The disk settles: no more faults. */
	calm(): void;
}

/** `disk` with `faults` drawn at `rate` per call on a file that is there (`next`: the seed's draws). */
export function faulty_fs(
	disk: Fs,
	next: () => number,
	{ rate, faults = DISK_FAULTS }: { rate: number; faults?: readonly DiskFault[] }
): FaultyFs {
	let calm = false;
	const touched = new Set<string>();
	const log: string[] = [];
	const gone = new Set<string>();
	const take = (fault: DiskFault, abs: string) => {
		touched.add(abs);
		log.push(`${fault} ${abs}`);
	};
	const draw = (fault: DiskFault) => !calm && faults.includes(fault) && next() < rate;
	return {
		touched,
		log,
		calm() {
			calm = true;
			gone.clear();
		},
		stat(abs) {
			const kind = disk.stat(abs);
			if (kind === 'file' && draw('gone-after-stat')) {
				gone.add(abs);
				take('gone-after-stat', abs);
			}
			return kind;
		},
		read(abs) {
			const text = disk.read(abs);
			if (text === null) return null;
			if (gone.delete(abs)) return null;
			if (draw('read-fails')) {
				take('read-fails', abs);
				return null;
			}
			if (text.length > 1 && draw('half-written')) {
				take('half-written', abs);
				return text.slice(0, 1 + Math.floor(next() * (text.length - 1)));
			}
			return text;
		},
		list: (dir) => disk.list(dir)
	};
}

/** What a faulty watcher can do to a run of events. */
export type WatchFault = 'lost' | 'twice' | 'reordered';
export const WATCH_FAULTS: readonly WatchFault[] = ['lost', 'twice', 'reordered'];

/** A save the watcher delivers (`heard`), or one it lost: the disk changed and nobody was told. Only
 *  a change to a file that was there is lost: after a lost create or delete the next save says
 *  `change` of a file Kit's own watcher never heard come or go either, and only a restart mends that. */
export interface Delivery {
	readonly file: string;
	readonly text: string | null;
	readonly heard: boolean;
}

/**
 * The saves `saves` (in the order the editor made them) as a faulty watcher delivers them: some
 * lost, some sent twice, and the run reordered, each at `rate`. A later save of a file still lands
 * after an earlier one of it on the disk: what reorders is when the compiler hears of each.
 */
export function watched(
	saves: readonly (readonly [string, string | null])[],
	next: () => number,
	{
		rate,
		faults = WATCH_FAULTS,
		there
	}: { rate: number; faults?: readonly WatchFault[]; there: (file: string) => boolean }
): { deliveries: Delivery[]; log: string[] } {
	const log: string[] = [];
	const out: Delivery[] = [];
	for (const [file, text] of saves) {
		if (text !== null && there(file) && faults.includes('lost') && next() < rate) {
			log.push(`lost ${file}`);
			out.push({ file, text, heard: false });
			continue;
		}
		out.push({ file, text, heard: true });
		if (faults.includes('twice') && next() < rate) {
			log.push(`twice ${file}`);
			out.push({ file, text, heard: true });
		}
	}
	if (faults.includes('reordered') && out.length > 1 && next() < rate) {
		const i = Math.floor(next() * (out.length - 1));
		const a = out[i];
		const b = out[i + 1];
		if (a.file !== b.file) {
			log.push(`reordered ${a.file} ${b.file}`);
			out[i] = b;
			out[i + 1] = a;
		}
	}
	return { deliveries: out, log };
}

/** The files a faulty run owes the compiler an event for: each a disk fault touched, and each whose
 *  save the watcher lost. */
export function owed(fs: FaultyFs, deliveries: readonly Delivery[], disk: MemoryFs): string[] {
	const files = new Set(fs.touched);
	for (const d of deliveries) if (!d.heard) files.add(d.file);
	return [...files].filter((f) => disk.read(f) !== null).sort();
}
