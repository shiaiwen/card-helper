import assert from 'node:assert/strict';
import { AI_CLIENT_ID_MIN, isAiClientId, isAiTipModeLabel } from '../src/features/ai-player/ai-client.ts';

assert.equal(isAiClientId(AI_CLIENT_ID_MIN), false);
assert.equal(isAiClientId(AI_CLIENT_ID_MIN + 1), true);
assert.equal(isAiClientId(1), false);
assert.equal(isAiTipModeLabel('天梯排位'), true);
assert.equal(isAiTipModeLabel('斗地主'), true);
assert.equal(isAiTipModeLabel('军争演武'), false);

console.log('ai-client: ok');
