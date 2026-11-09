/**
 * The ONE canonical side-channel escape. A devalue/JSON payload emitted inside a `<script>` must not
 * be able to break out of it — escaping `<` neutralizes `</script>`, `<script`, and `<!--`. Every seed
 * / marker serializer (page seed, remote seed, context markers, streamed resolve scripts) routes its
 * payload through here, so the escape lives in exactly one auditable place.
 */
export declare function escape_script_text(s: string): string;
/**
 * An attribute value for a double-quoted attribute: `&`, `"`, `<` escaped. One pass; a value with
 * none of them (nearly every href) comes back as itself, no copy.
 */
export declare function escape_attr(s: string): string;
/** `&` only (a URL into an attribute: its query's separators). No copy without one. */
export declare function escape_amp(s: string): string;
/** `&` and `"` only (a value re-emitted into a double-quoted attribute exactly as it was, `<` kept). */
export declare function escape_amp_quot(s: string): string;
/** Text content: `&`, `<`, `>` escaped. Text with none of them comes back as itself, no copy. */
export declare function escape_text(s: string): string;
