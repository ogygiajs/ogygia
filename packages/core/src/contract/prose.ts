/**
 * Write a message as it reads: an indented paragraph in the source, one line in the console.
 *
 *   prose`
 *     island "${a.entry}" was edited while it slept, so its server HTML
 *     was put back and hydrated.
 *
 *     ${a.drift && `What drifted: ${a.drift}`}
 *   `
 *
 * The indentation goes, the lines of a paragraph join with a space, a blank line starts a new one
 * (`\n`), and a paragraph left empty (a value that is `''`, `false`, `null`) is dropped. Values go in
 * as they are. Dev only: it runs inside a message table, which a production build drops.
 */
export function prose(strings: TemplateStringsArray, ...values: unknown[]): string {
	const paragraphs: string[] = [];
	let current = '';
	const end_paragraph = () => {
		const text = current.trim();
		if (text) paragraphs.push(text);
		current = '';
	};
	strings.forEach((part, i) => {
		const lines = part.split('\n');
		const last = lines.length - 1;
		lines.forEach((line, j) => {
			if (j > 0) {
				// a blank line ends the paragraph; a line break inside one is a space
				if (line.trim() === '' && j < last) end_paragraph();
				else current = `${current} `;
			}
			// (a line's own trailing spaces go, except right before a value: `for ${x}`)
			const text = j === 0 ? line : line.trimStart();
			current += j === last ? text : text.trimEnd();
		});
		if (i < values.length) {
			const value = values[i];
			if (value !== null && value !== undefined && value !== false)
				current = `${current}${String(value)}`;
		}
	});
	end_paragraph();
	return paragraphs.join('\n');
}
