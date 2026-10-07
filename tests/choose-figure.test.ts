import assert from 'node:assert/strict';
import { figureByClientOrder, figureForChooseIdentityOrder } from '../src/features/identity-drill/choose-figure.ts';
import { shouldRevealIdentityFigures } from '../src/features/identity-drill/choose-figure-controller.ts';

assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(figureForChooseIdentityOrder), [1, 2, 2, 4, 3, 3, 3, 3]);
const ids = [11, 12, 13, 14, 15, 16, 17, 18];
assert.equal(figureByClientOrder(ids, 11), 1);
assert.equal(figureByClientOrder(ids, 14), 4);
assert.equal(figureByClientOrder(ids, 18), 3);
assert.equal(figureByClientOrder(ids.slice(0, 7), 11), 0);
assert.equal(figureByClientOrder(ids, 99), 0);
assert.equal(shouldRevealIdentityFigures({ modeText: '身份演武', chooseFigure: true }), true);
assert.equal(shouldRevealIdentityFigures({ modeText: '身份演武军争 自选身份', chooseFigure: false }), true);
assert.equal(shouldRevealIdentityFigures({ modeText: '身份演武', chooseFigure: false }), false);
assert.equal(shouldRevealIdentityFigures({ modeText: '国战演武 自选身份', chooseFigure: false }), false);
assert.equal(shouldRevealIdentityFigures({ modeText: '', modeType: 74, chooseFigure: true }), true);

console.log('choose-figure: ok');
