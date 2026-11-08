import { defineConfig } from 'vitest/config';
import { pluginTests } from '@ogygia/config/vitest';

// (the digest test reads profiler reports through @ogygia/devtools, whose modules use Svelte runes)
export default defineConfig(pluginTests());
