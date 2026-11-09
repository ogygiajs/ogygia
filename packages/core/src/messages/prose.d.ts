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
export declare function prose(strings: TemplateStringsArray, ...values: unknown[]): string;
