import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiaochaoConfigStore } from '../src/config/config-store.ts';
import { installSeatDisplayVisibility } from '../src/features/seat-display/seat-display-visibility.ts';

test('owns seat display visibility and restores the document on cleanup', () => {
  let enabled = true;
  let subscriber: ((detail: { value: boolean }) => void) | undefined;
  let styleRemoved = false;
  const appendedStyles: any[] = [];
  const rootElement = { dataset: {} as Record<string, string> };
  const documentObject = {
    documentElement: rootElement,
    head: { appendChild: (element: any) => appendedStyles.push(element) },
    createElement: () => ({
      id: '',
      textContent: '',
      remove: () => { styleRemoved = true; }
    })
  } as unknown as Document;
  const configStore = {
    get: () => enabled,
    subscribe: (_key: string, nextSubscriber: typeof subscriber) => {
      subscriber = nextSubscriber;
      return () => { subscriber = undefined; };
    }
  } as unknown as XiaochaoConfigStore;

  const dispose = installSeatDisplayVisibility(configStore, documentObject);
  assert.equal(rootElement.dataset.xcSeatDisplayEnabled, 'true');
  assert.match(appendedStyles[0].textContent, /#seatUI \{ display: none !important/);
  assert.doesNotMatch(
    appendedStyles[0].textContent,
    /data-xc-seat-display-enabled="true"] #xiaochao-vue-seat-overlay \{ display: block !important/
  );

  enabled = false;
  subscriber?.({ value: enabled });
  assert.equal(rootElement.dataset.xcSeatDisplayEnabled, 'false');
  assert.match(
    appendedStyles[0].textContent,
    /data-xc-seat-display-enabled="false"] #xiaochao-vue-seat-overlay \{ display: none !important/
  );
  dispose();
  assert.equal(rootElement.dataset.xcSeatDisplayEnabled, undefined);
  assert.equal(styleRemoved, true);
});
