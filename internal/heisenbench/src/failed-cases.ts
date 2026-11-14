/** A bench case that threw, as its Heisenbench report says. */
export interface FailedCase {
	name: string;
	file: string;
	error: string;
}

type Report = { cases?: { name: string; file: string; error?: string }[] };

/** Every case of `reports` whose run threw (its report carries an `error`). */
export function failed_cases(reports: readonly Report[]): FailedCase[] {
	const out: FailedCase[] = [];
	for (const r of reports)
		for (const c of r.cases ?? [])
			if (typeof c.error === 'string') out.push({ name: c.name, file: c.file, error: c.error });
	return out;
}

/** The gate's lines for the cases that threw: '' when none did. */
export function failed_cases_md(failed: readonly FailedCase[]): string {
	if (!failed.length) return '';
	const lines = failed.map((c) => `- \`${c.file}\` › ${c.name}: ${c.error.split('\n')[0]}`);
	const head = `**${failed.length} bench case${failed.length === 1 ? '' : 's'} threw.** A case that throws measures nothing; fix it so it runs:`;
	return ['', head, '', ...lines, ''].join('\n');
}
