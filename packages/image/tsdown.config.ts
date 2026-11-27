import { library } from '@ogygia/config/tsdown';

export default library({
	// the encoder: installed with the plugin, resolved by the app at build
	external: ['sharp', 'vite']
});
