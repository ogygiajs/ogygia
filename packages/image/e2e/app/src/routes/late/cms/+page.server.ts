import { remoteImage } from '@ogygia/image';

export const prerender = false;

const box = { width: 1200, height: 800 };

export const load = () => ({
	listed: remoteImage('http://127.0.0.1:4176/photos/field.jpg', { ...box, version: 2 }),
	unlisted: remoteImage('http://127.0.0.1:4177/photos/field.jpg', box),
	huge: remoteImage('http://127.0.0.1:4176/huge.jpg', box),
	slow: remoteImage('http://127.0.0.1:4176/slow.jpg', box)
});
