/**
 * 协议级屏蔽：击杀特效、他人动态皮肤、势力口号聊天消息改写。
 */

import { FACTION_SLOGANS } from './faction-slogans.ts';

type UnknownRecord = Record<string, unknown>;

/** 势力口号只出现在该聊天频道。 */
const FACTION_SLOGAN_CHANNEL = 2;

export interface BlockMessageFilterOptions {
  killEffect: boolean;
  otherSkinState: boolean;
  factionSlogan: boolean;
  isOwnGeneral(generalId: number): boolean;
}

/**
 * 在协议分发前改写消息：击杀特效把 Type 置 0；他人动态皮肤把非本家
 * 武将的皮肤 state 置 0；势力口号删除游戏读取的 data.protoObj 使其不显示。
 * 必须在游戏处理该协议前调用。
 */
export function applyBlockMessageFilters(
  payload: UnknownRecord,
  className: string,
  options: BlockMessageFilterOptions
): void {
  if (className === 'CClientGameRewardPointNTF') {
    if (options.killEffect) payload.Type = 0;
    return;
  }
  if (className === 'decodeSSCChatmsgNtf') {
    if (options.factionSlogan && isFactionSlogan(payload)) {
      const data = payload.data;
      if (data && typeof data === 'object') delete (data as UnknownRecord).protoObj;
    }
    return;
  }
  if (className === 'ClientGeneralSkinRep' && options.otherSkinState) {
    const list = payload.GeneralSkinList;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const skin = item as UnknownRecord;
      if (!options.isOwnGeneral(Number(skin.GeneralID))) skin.state = 0;
    }
  }
}

function isFactionSlogan(payload: UnknownRecord): boolean {
  const chat = payload.ProtoObj;
  if (!chat || typeof chat !== 'object') return false;
  const { Channel, channel, chatMsg, ChatMsg } = chat as UnknownRecord;
  const text = chatMsg || ChatMsg;
  return (Channel ?? channel) == FACTION_SLOGAN_CHANNEL && typeof text === 'string' && FACTION_SLOGANS.has(text);
}
