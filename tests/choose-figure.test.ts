import assert from 'node:assert/strict';
import { figureByClientOrder } from '../src/features/identity-drill/choose-figure.ts';
import { isChooseFigure } from '../src/features/identity-drill/choose-figure-controller.ts';

assert.equal(isChooseFigure({ IsChooseFigure: true }), true);
assert.equal(isChooseFigure({ IsChooseFigure: 1 }), true);
assert.equal(isChooseFigure({ IsChooseFigure: '1' }), true);
assert.equal(isChooseFigure({ IsChooseFigure: false }), false);
assert.equal(isChooseFigure(null), false);

const ids = ['11', '22', '33', '44', '55', '66', '77', '88'];
assert.equal(figureByClientOrder(ids, '11'), 1);
assert.equal(figureByClientOrder(ids, '44'), 4);
assert.equal(figureByClientOrder(ids, '55'), 3);
assert.equal(figureByClientOrder(ids.slice(0, 7), '11'), 0);

console.log('choose-figure ok');
