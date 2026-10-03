type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function readText(value: unknown): string {
  if (value == null) return '';
  const text = String(value).trim();
  return !text || text === 'undefined' || text === 'null' ? '' : text;
}

function hasIdentityFields(value: UnknownRecord | null): value is UnknownRecord {
  if (!value) return false;
  return value.clientId != null
    || value.ClientId != null
    || value.userID != null
    || value.nickname != null
    || value.NickName != null;
}

function identityFrom(value: UnknownRecord | null): { userId: string; nickname: string } | null {
  if (!hasIdentityFields(value)) return null;
  const userId = readText(value.clientId ?? value.ClientId ?? value.userID ?? value.UserID);
  const nickname = readText(value.nickname ?? value.NickName ?? value.nickName);
  if (!userId && !nickname) return null;
  return { userId, nickname };
}

function selfFromUserDataClass(ctor: unknown): UnknownRecord | null {
  const record = asRecord(ctor);
  return asRecord(record?.Self) ?? asRecord(record?.self);
}

/** 对照 app.bak：BirthdayWishWin.userData 的构造函数就是 UserData。 */
function selfFromUserDataInstance(userData: unknown): UnknownRecord | null {
  const record = asRecord(userData);
  if (!record) return null;
  const direct = identityFrom(record);
  if (direct) return record;
  try {
    const proto = Object.getPrototypeOf(record);
    const ctor = asRecord(proto)?.constructor ?? asRecord(record.__proto__)?.constructor;
    return selfFromUserDataClass(ctor);
  } catch {
    return null;
  }
}

function windowManager(): UnknownRecord | null {
  const laya = asRecord((window as unknown as { Laya?: unknown }).Laya);
  const stage = asRecord(laya?.stage);
  if (!stage) return null;

  // WindowManager 在事件监听者里；先扫 WindowLayer / 字典。
  const engineering = asRecord((window as unknown as { __XIAOCHAO_ENGINEERING__?: unknown }).__XIAOCHAO_ENGINEERING__);
  const locator = asRecord(engineering?.locator);
  const manager = locator?.manager;
  if (typeof manager === 'function') {
    try {
      return asRecord(manager.call(locator, 'WindowManager'));
    } catch {
      // 继续走显示树。
    }
  }
  return null;
}

function eachWindowInstance(visit: (win: UnknownRecord) => UnknownRecord | null): UnknownRecord | null {
  const manager = windowManager();
  const dict = asRecord(manager?.WindowInstanceDict);
  if (dict) {
    const values = typeof dict.values === 'function' ? Array.from(dict.values() as Iterable<unknown>) : [];
    for (const item of values) {
      const found = visit(asRecord(item) ?? {});
      if (found) return found;
    }
    if (typeof dict.forEach === 'function') {
      let matched: UnknownRecord | null = null;
      dict.forEach.call(dict, (item: unknown) => {
        if (matched) return;
        matched = visit(asRecord(item) ?? {});
      });
      if (matched) return matched;
    }
  }

  const laya = asRecord((window as unknown as { Laya?: unknown }).Laya);
  const queue = [asRecord(laya?.stage)].filter(Boolean) as UnknownRecord[];
  for (let index = 0; index < queue.length && index < 400; index += 1) {
    const node = queue[index];
    const found = visit(node);
    if (found) return found;
    const kids = node._children ?? node.numChildren;
    if (Array.isArray(node._children)) {
      for (const child of node._children) {
        const record = asRecord(child);
        if (record) queue.push(record);
      }
    } else if (typeof kids === 'number' && typeof node.getChildAt === 'function') {
      for (let childIndex = 0; childIndex < kids; childIndex += 1) {
        const record = asRecord((node.getChildAt as (i: number) => unknown)(childIndex));
        if (record) queue.push(record);
      }
    }
  }
  return null;
}

/** 对照 app.bak：zy.class("UserData").Self。 */
export function readSelfIdentity(): { userId: string; nickname: string } {
  const self = resolveUserSelf();
  return identityFrom(self) ?? { userId: '', nickname: '' };
}

function loginIdentity(): UnknownRecord | null {
  const engineering = asRecord((window as unknown as { __XIAOCHAO_ENGINEERING__?: unknown }).__XIAOCHAO_ENGINEERING__);
  const locator = asRecord(engineering?.locator);
  const manager = locator?.manager;
  let user: UnknownRecord | null = null;
  if (typeof manager === 'function') {
    try {
      user = asRecord(manager.call(locator, 'UserInfoManger'))
        ?? asRecord(manager.call(locator, 'UserInfoManager'));
    } catch {
      user = null;
    }
  }
  const context = asRecord((window as unknown as { GameContext?: unknown }).GameContext);
  const source = user ?? context;
  if (!source) return null;
  const userId = readText(source.myID ?? source.MyID ?? source.clientId ?? source.ClientId ?? source.userID ?? source.UserID);
  const nickname = readText(
    source.nickname ?? source.NickName ?? source.nickName ?? source.showName ?? source.ShowName ?? source.userName
  );
  if (!userId && !nickname) return null;
  return { clientId: userId, nickname };
}

function resolveUserSelf(): UnknownRecord | null {
  const laya = asRecord((window as unknown as { Laya?: unknown }).Laya);
  const classUtils = asRecord(laya?.ClassUtils);
  try {
    const getClass = classUtils?.getClass;
    if (typeof getClass === 'function') {
      const fromClass = selfFromUserDataClass(getClass.call(classUtils, 'UserData'));
      if (fromClass && hasIdentityFields(fromClass)) return fromClass;
    }
  } catch {
    // 类表没有 Self 时走登录账号。
  }

  const loggedIn = loginIdentity();
  if (loggedIn) return loggedIn;

  const fromWindows = eachWindowInstance((win) => {
    const byName = String(win.name || '') === 'BirthdayWishWin' || String(asRecord(win.constructor)?.name || '') === 'BirthdayWishWin';
    if (!byName || win.userData == null) return null;
    const self = selfFromUserDataInstance(win.userData);
    if (self && hasIdentityFields(self)) return self;
    return null;
  });
  if (fromWindows) return fromWindows;

  return null;
}

/**
 * 只展示当前登录账号。文案由脚本写入，避免 Vue 重绘盖掉。
 * 其它窗口上的 clientId、节点 name，以及页面里残留的同名节点，都不是这个账号。
 */
export function placeToolsIdentity(_root: ParentNode = document): void {
  const host = document.getElementById('xiaochao-tools-identity');
  if (!host) return;

  const idNode = host.querySelector<HTMLElement>('#uuid');
  const nameNode = host.querySelector<HTMLElement>('#nickName');
  if (!idNode || !nameNode) return;

  for (const node of Array.from(document.querySelectorAll('#uuid, #nickName'))) {
    const element = node as HTMLElement;
    if (!element || host.contains(element) || element === idNode || element === nameNode) continue;
    element.remove?.();
  }

  const identity = readSelfIdentity();
  if (identity.userId) idNode.textContent = `id：${identity.userId}`;
  else if (!idNode.textContent?.trim()) idNode.textContent = 'id：';
  if (identity.nickname) nameNode.textContent = `昵称：${identity.nickname}`;
  else if (!nameNode.textContent?.trim()) nameNode.textContent = '昵称：';
}

/** 登录后账号信息会晚到；旧脚本写入后也在这里同步。 */
export function startToolsIdentitySync(intervalMs = 800): () => void {
  placeToolsIdentity();
  const timer = window.setInterval(() => placeToolsIdentity(), intervalMs);
  return () => window.clearInterval(timer);
}
