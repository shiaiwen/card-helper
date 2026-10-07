import assert from 'node:assert/strict';
import { createZuifengUses, formatZuifengTip, zuifengRemaining } from '../src/features/extra-assist/zuifeng-assist.ts';

assert.equal(zuifengRemaining(4, 0), 4);
assert.equal(zuifengRemaining(4, 1), 3);
assert.equal(zuifengRemaining(4, 4), 0);
assert.equal(zuifengRemaining(4, 9), 0);
assert.equal(zuifengRemaining(0, 0), 0);

const uses = createZuifengUses();
uses.noteUse(2);
uses.noteUse(2);
assert.equal(uses.used(2), 2);
uses.resetSeat(2);
assert.equal(uses.used(2), 0);
uses.noteUse(1);
uses.resetAll();
assert.equal(uses.used(1), 0);

const seat = { MaxHp: 3, HasSkill: (id: number) => id === 88 };
assert.equal(formatZuifengTip(seat, [88], 1), '醉锋2');
assert.equal(formatZuifengTip(seat, [99], 0), '');
assert.equal(formatZuifengTip({ MaxHp: 3 }, [88], 0), '');

console.log('zuifeng-assist: ok');
