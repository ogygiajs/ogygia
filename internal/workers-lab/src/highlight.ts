/** Shiki, loaded once per thread (each worker pays this at start: see the doc's startup numbers). */
import { createHighlighter } from 'shiki';

const highlighter = await createHighlighter({ themes: ['github-light'], langs: ['typescript'] });

export function highlight(source: string): string {
	return highlighter.codeToHtml(source, { lang: 'typescript', theme: 'github-light' });
}
