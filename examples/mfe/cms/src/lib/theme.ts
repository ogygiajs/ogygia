import { createContext } from 'ogygia';

export const [getTheme, setTheme] = createContext<string>('mfe-cms-set-theme');
