import type { DevtoolsEvent } from '@ogygia/core/events';

/** The bus event named `N`, out of the whole union. */
export type EventNamed<N extends DevtoolsEvent['name']> = Extract<DevtoolsEvent, { name: N }>;
