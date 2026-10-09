import assert from 'node:assert/strict';
import { aiKind, isAiClientId, readNestedClientId } from '../src/features/ai-player/ai-client.ts';

assert.equal(aiKind(0xee6b2800 - 1, false), 0);
assert.equal(aiKind(0xee6b2800, false), 1);
assert.equal(aiKind(0xee6b2801, true), 2);
assert.equal(isAiClientId(0xee6b2800), true);
assert.equal(isAiClientId(12), false);
assert.equal(readNestedClientId({ userID: 0xee6b2801, ClientId: 12 }), 12);
assert.equal(readNestedClientId({ playerInfo: { ClientId: 0xee6b2801, IsNormalRobot: true } }), 0xee6b2801);

console.log('ai-client ok');
