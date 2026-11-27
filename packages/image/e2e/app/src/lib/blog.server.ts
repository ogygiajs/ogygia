import { content, markdown } from '@ogygia/content';
import { isImage, type ImageDescriptor } from '@ogygia/image';
import * as v from 'valibot';

export const blog = content({
	loader: markdown(import.meta.glob('../content/blog/*/+post.md', { eager: true }), {
		id: (key) => key.split('/').at(-2) ?? key
	}),
	schema: v.object({
		title: v.string(),
		cover: v.custom<ImageDescriptor>(isImage)
	})
});
