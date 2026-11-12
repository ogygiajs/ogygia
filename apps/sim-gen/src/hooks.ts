// A held region crosses the wire (a remote query's answer, a live query's tick): ogygia's codec.
import * as ogygia from 'ogygia';

export const transport = { ...ogygia.transport };
