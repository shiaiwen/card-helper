import assert from 'node:assert/strict';
import { isXinyouCardGain, xinyouTagExpires } from '../src/features/mingpai/xinyou-tag.ts';

const hand = 5;
assert.equal(isXinyouCardGain({
  spellMatched: true, toZone: hand, toId: 2, srcSeatId: 2, casterSeatId: 2
}), true);
assert.equal(isXinyouCardGain({
  spellMatched: true, toZone: hand, toId: 4, srcSeatId: 2, casterSeatId: 2
}), false);
assert.equal(isXinyouCardGain({
  spellMatched: true, toZone: 2, toId: 2, srcSeatId: 2, casterSeatId: 2
}), false);
assert.equal(isXinyouCardGain({
  spellMatched: false, toZone: hand, toId: 2, srcSeatId: 2, casterSeatId: 2
}), false);
assert.equal(isXinyouCardGain({
  spellMatched: true, toZone: hand, toId: 2, srcSeatId: 2, casterSeatId: null
}), true);
assert.equal(isXinyouCardGain({
  spellMatched: true, toZone: hand, toId: 4, srcSeatId: 2, casterSeatId: null
}), false);
assert.equal(xinyouTagExpires(5), false);
assert.equal(xinyouTagExpires(6), true);
assert.equal(xinyouTagExpires(4), false);

console.log('xinyou-tag: ok');
