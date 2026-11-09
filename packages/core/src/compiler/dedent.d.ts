/**
 * Strip the common leading indentation from a block of source, and trim leading/trailing blank
 * lines. Source embedded in a call (`import.meta.og.code(\`…\`, …)`) is indented to match where the
 * call sits; that indentation is an artifact of the surrounding code, not part of the snippet. This
 * normalizes it so the rendered `<pre>` shows the snippet's OWN logical indentation, flush-left.
 *
 * Blank lines (whitespace-only) don't count toward the common indent; tabs and spaces are treated by
 * their literal column contribution to the prefix (the common prefix is computed on raw characters,
 * so mixed tabs/spaces still de-indent correctly as long as the leading run is consistent — which it
 * is for machine-indented source).
 *
 * Also a TAG, for the code the compiler generates (its virtual modules), written as the code itself:
 *
 *     dedent`
 *         export const dev = ${is_dev};
 *     `
 *
 * The template's own text is de-indented first and the values go in after, so a value spanning lines
 * (a generated block) never decides the indent. Values are interpolated as a template literal would
 * (cooked strings: `\\n` in the template is a newline).
 */
export declare function dedent(text: string): string;
export declare function dedent(strings: TemplateStringsArray, ...values: unknown[]): string;
