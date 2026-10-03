import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeToolsIdentity, readSelfIdentity } from '../src/ui/settings/tools-identity.ts';

describe('工具页账号信息', () => {
  it('从 UserData.Self 读取 id 和昵称', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
      Laya: {
        ClassUtils: {
          getClass: () => ({ Self: { clientId: 12345, nickname: '测试号' } })
        }
      },
      document: previousWindow?.document
    } as unknown as Window & typeof globalThis;
    try {
      assert.deepEqual(readSelfIdentity(), { userId: '12345', nickname: '测试号' });
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it('从 BirthdayWishWin.userData 构造函数上的 Self 读取', () => {
    const previousWindow = globalThis.window;
    const Self = { clientId: 99, NickName: '窗口昵称' };
    function UserData() {}
    (UserData as unknown as { Self: typeof Self }).Self = Self;
    const userDataInstance = new (UserData as unknown as new () => object)();
    globalThis.window = {
      Laya: { stage: { _children: [] } },
      __XIAOCHAO_ENGINEERING__: {
        locator: {
          manager: () => ({
            WindowInstanceDict: {
              values: () => [{ name: 'BirthdayWishWin', userData: userDataInstance }]
            }
          })
        }
      },
      document: previousWindow?.document
    } as unknown as Window & typeof globalThis;
    try {
      assert.deepEqual(readSelfIdentity(), { userId: '99', nickname: '窗口昵称' });
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it('从 UserInfoManger 读取当前登录账号', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
      Laya: { ClassUtils: { getClass: () => null }, stage: { _children: [] } },
      __XIAOCHAO_ENGINEERING__: {
        locator: {
          manager: (name: string) => name === 'UserInfoManger'
            ? { myID: 42, nickName: '登录号' }
            : null
        }
      },
      document: previousWindow?.document
    } as unknown as Window & typeof globalThis;
    try {
      assert.deepEqual(readSelfIdentity(), { userId: '42', nickname: '登录号' });
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it('不采用其它窗口上的 id，也不把节点 name 当昵称', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
      Laya: {
        ClassUtils: { getClass: () => null },
        stage: {
          _children: [{ name: '武将名', clientId: 777, userID: 777 }]
        }
      },
      document: previousWindow?.document
    } as unknown as Window & typeof globalThis;
    try {
      assert.deepEqual(readSelfIdentity(), { userId: '', nickname: '' });
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it('写入展示节点且不依赖模板占位文案', () => {
    const previousDocument = globalThis.document;
    const idNode = { id: 'uuid', textContent: '', matches: () => false } as unknown as HTMLElement;
    const nameNode = { id: 'nickName', textContent: '', matches: () => false } as unknown as HTMLElement;
    const host = {
      id: 'xiaochao-tools-identity',
      contains(node: HTMLElement) {
        return node === idNode || node === nameNode;
      },
      querySelector(selector: string) {
        if (selector === '#uuid') return idNode;
        if (selector === '#nickName') return nameNode;
        return null;
      }
    };
    const doc = {
      getElementById(id: string) {
        return id === 'xiaochao-tools-identity' ? host : null;
      },
      querySelectorAll(selector: string) {
        if (selector === '#uuid, #nickName') return [idNode, nameNode];
        return [];
      }
    };
    globalThis.document = doc as unknown as Document;
    globalThis.window = {
      Laya: {
        ClassUtils: {
          getClass: () => ({ Self: { clientId: 88, nickname: '居中昵称' } })
        }
      },
      document: doc
    } as unknown as Window & typeof globalThis;
    try {
      placeToolsIdentity();
      assert.equal(idNode.textContent, 'id：88');
      assert.equal(nameNode.textContent, '昵称：居中昵称');
    } finally {
      globalThis.document = previousDocument;
    }
  });
});
