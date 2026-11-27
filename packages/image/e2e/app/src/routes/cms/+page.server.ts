import { remoteImage } from '@ogygia/image';

export const load = () => ({
	cover: remoteImage('http://127.0.0.1:4176/photos/cover.jpg', {
		width: 1600,
		height: 900,
		alt: 'A cover from the CMS'
	})
});
