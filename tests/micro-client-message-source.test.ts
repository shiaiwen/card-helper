import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGameEventBus, type GameEvent } from '../src/runtime/game-event-bus.ts';
import { installMicroClientMessageSource } from '../src/adapters/micro-client-message-source.ts';

const OPT_TARGET = {
  ClassName: 'GsCRoleOptTargetNtf',
  SeatID: 1, SrcSeatID: 1, targetSeatID: 255, SpellID: 945, Param: 0, Params: [7, 75]
};

function setup() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(console, 'log')!;
  let tick: (() => void) | null = null;
  const fakeWindow = {
    setInterval: (callback: () => void) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => undefined
  } as unknown as Window;
  const bus = createGameEventBus();
  const received: GameEvent[] = [];
  bus.subscribe((event) => received.push(event));
  const dispose = installMicroClientMessageSource(bus, fakeWindow);
  const advance = (times: number) => {
    for (let index = 0; index < times; index += 1) tick?.();
  };
  const cleanup = () => {
    dispose();
    Object.defineProperty(console, 'log', originalDescriptor);
  };
  return { received, advance, cleanup };
}

describe('微端协议消息来源：console.log 兼容桥', () => {
  it('游戏在兼容桥安装后重新赋值 console.log，仍能收到协议消息', () => {
    const { received, advance, cleanup } = setup();
    try {
      advance(8);
      let silencedCalls = 0;
      console.log = () => {
        silencedCalls += 1;
      };
      console.log(OPT_TARGET);
      assert.equal(received.filter((event) => event.type === 'opt-target').length, 1);
      assert.equal(silencedCalls, 1);
    } finally {
      cleanup();
    }
  });

  it('console.log 被 defineProperty 整体替换后，下一次轮询重新接管', () => {
    const { received, advance, cleanup } = setup();
    try {
      advance(8);
      Object.defineProperty(console, 'log', { configurable: true, writable: true, value: () => undefined });
      console.log(OPT_TARGET);
      assert.equal(received.length, 0);
      advance(1);
      console.log(OPT_TARGET);
      assert.equal(received.filter((event) => event.type === 'opt-target').length, 1);
    } finally {
      cleanup();
    }
  });
});
