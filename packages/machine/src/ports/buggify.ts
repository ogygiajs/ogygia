import { realm } from './realm.ts';

/**
 * BUGGIFY: whether the rare branch `point` is taken now. A real branch that is rare in a test (a
 * kept answer dropped, a reply lost after the work was applied) is taken on purpose in a simulated
 * run, at the seed's choice, so what follows it is tested on every seed instead of once a month in
 * the field. Only a simulated platform answers true (internal/sim); no real one has `buggify`.
 *
 * A call site is behind its file's own rules constant (a bundler folds a constant of the file, not
 * one imported), so a production build folds the call and the point's name out
 * (packages/core/test/rules-stripped.node.test.ts proves it):
 *
 *   const RULES = import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);
 *   if (RULES && buggify.fires('outbox.reply-lost')) throw new Error('…');
 *
 * A point names its area and the branch: `<area>.<what happens>`.
 */
export const fires = (point: string): boolean => realm.buggify?.(point) === true;
