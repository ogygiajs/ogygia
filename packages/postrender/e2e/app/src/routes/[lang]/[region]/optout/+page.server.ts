// OPT-OUT proof: this page is PURE (reads nothing per-visitor), so with the default on it would
// normally store. Kit's own `config` turns it off — the handle must NOT store/serve it. Kit takes any
// key inside `config`, so nothing is stripped from this file.
export const config = { postrender: false };
export const load = () => ({ note: 'pure but opted out' });
