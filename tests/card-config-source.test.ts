import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCardDictionary } from '../src/adapters/card-config-source.ts';

test('卡牌字典按缩写表还原字段，并从技能表补全牌名与描述', () => {
  const dictionary = buildCardDictionary(
    {
      abbreviation: [
        { Short: 'a', Long: 'id' },
        { Short: 'b', Long: 'spellId' },
        { Short: 'c', Long: 'Color' },
        { Short: 'd', Long: 'Number' }
      ],
      GamePlayCards: {
        card: [
          { a: 30101, b: 4, c: 3, d: 1 },
          { a: 10205, b: 5, c: 1, d: 2, name: '自带名' },
          { a: 0, b: 4 }
        ]
      }
    },
    { GameSpells: { spell: [{ a: 4, c: '杀', o: '<b>出牌阶段</b>对一名角色使用;\n' }, { a: 5, c: '闪' }] } }
  );

  assert.deepEqual(Object.keys(dictionary).map(Number).sort(), [10205, 30101]);
  assert.equal(dictionary[30101].name, '杀');
  assert.equal(dictionary[30101].desc, '出牌阶段对一名角色使用');
  assert.equal(dictionary[30101].Color, 3);
  assert.equal(dictionary[10205].name, '自带名');
});
