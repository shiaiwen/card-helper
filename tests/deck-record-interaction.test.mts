import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeckRecordInteraction } from '../src/features/deck-record/deck-record-interaction.ts';

test('deck record interaction publishes list and force reopen', () => {
  const interaction = createDeckRecordInteraction();
  const snapshots = [];
  interaction.subscribe((snapshot) => snapshots.push({
    activeList: snapshot.activeList,
    anchor: snapshot.anchor
  }));

  interaction.setActiveList('discard');
  interaction.setActiveList('discard');
  interaction.setActiveList('discard', { force: true });
  interaction.setAnchor({ left: 10, top: 20, width: 120, height: 22 });
  interaction.setAnchor({ left: 10, top: 20, width: 120, height: 22 });
  interaction.setActiveList(null);

  assert.equal(snapshots.at(-1)?.activeList, null);
  assert.deepEqual(
    snapshots.map((item) => item.activeList),
    [null, 'discard', 'discard', 'discard', null]
  );
  assert.deepEqual(snapshots.at(-2)?.anchor, {
    left: 10,
    top: 20,
    width: 120,
    height: 22
  });
  assert.equal(
    snapshots.filter((item) => item.activeList === 'discard').length,
    3,
    'force reopen should publish even when the list is unchanged'
  );
});
