import type {
  RogueChooseMeta,
  RogueCityMeta,
  RogueFightMeta,
  RogueMapConfigData,
  RoguePlotMeta
} from './rogue-map-types.ts';

type UnknownRecord = Record<string, unknown>;

export interface RogueMapNameTables {
  /** spellId → { name, desc }，来自 cha_spell */
  spells?: Map<number, { name: string; desc: string }>;
  /** cardId → { name, desc, subType?, type?, color?, number? }，来自 sys_playcard */
  cards?: Map<number, {
    name: string;
    desc?: string;
    subType?: number;
    type?: number;
    color?: unknown;
    number?: unknown;
  }>;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rootOf(value: unknown): UnknownRecord | null {
  const record = asRecord(value);
  return asRecord(record?.Root) ?? asRecord(record?.root) ?? record;
}

/** `root.abbreviation` 与 `Root` 并列；对照 app.bak `hp`/`L4`。 */
function readAbbreviationMap(raw: unknown): Map<string, string> {
  const record = asRecord(raw);
  const metaRoot = asRecord(record?.root) ?? asRecord(record?.Root) ?? record;
  const table = new Map<string, string>();
  for (const entry of asArray(metaRoot?.abbreviation ?? metaRoot?.Abbreviation)) {
    const item = asRecord(entry);
    if (!item || typeof item.Short !== 'string' || typeof item.Long !== 'string') continue;
    table.set(item.Short, item.Long);
  }
  return table;
}

function expandRecord(record: UnknownRecord, abbreviation: Map<string, string>): UnknownRecord {
  const expanded: UnknownRecord = {};
  for (const [key, value] of Object.entries(record)) {
    expanded[abbreviation.get(key) ?? key] = value;
  }
  return expanded;
}

function localize(textTable: Record<string, string>, value: unknown): string {
  if (value == null) return '';
  const key = String(value);
  return textTable[key] ?? key;
}

function buildTextTable(root: UnknownRecord): Record<string, string> {
  const table: Record<string, string> = {};
  for (const entry of asArray(root.Text ?? root.text)) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = record.ID ?? record.id;
    const text = record.text ?? record.Text;
    if (id == null || text == null) continue;
    table[String(id)] = String(text);
  }
  return table;
}

function buildChapterNames(root: UnknownRecord): Record<string, string> {
  const table: Record<string, string> = {};
  for (const entry of asArray(root.Chapter)) {
    const record = asRecord(entry);
    if (!record) continue;
    const seasonID = record.seasonID;
    const chapter = record.chapter;
    const cityName = record.cityName;
    const location = String(record.location ?? '');
    const boss = record.bosslocation;
    const label = `${seasonID}-${chapter}${cityName ?? ''}`;
    for (const part of location.split(';')) {
      if (part) table[part] = label;
    }
    if (boss != null && boss !== '') table[String(boss)] = `${label}BOSS`;
  }
  return table;
}

function buildRcity(root: UnknownRecord, chapterNames: Record<string, string>): Record<string, RogueCityMeta> {
  const table: Record<string, RogueCityMeta> = {};
  for (const entry of asArray(root.Level)) {
    const record = asRecord(entry);
    if (!record) continue;
    const cityID = record.cityID ?? record.cityId;
    if (cityID == null) continue;
    const coordinate = String(record.citycoordinate ?? '0,0');
    const [xText, yText] = coordinate.split(',');
    const x = Number(xText) || 0;
    const y = -(Number(yText) || 0);
    const citypic = typeof record.citypic === 'string' ? record.citypic : '';
    const fallbackName = citypic.replace(/^city_([0-9]+)_(.+?)(\.png)?$/, (_m, a, b) => `${a}${b}`);
    table[String(cityID)] = {
      x,
      y,
      boss: record.startshow,
      cp: chapterNames[String(cityID)],
      spell: record.scenespell,
      desc: record.scenesDesc,
      name: typeof record.cityname === 'string' ? record.cityname : fallbackName
    };
  }
  return table;
}

function buildGeneralGroups(
  root: UnknownRecord,
  abbreviation: Map<string, string>
): Record<string, UnknownRecord[]> {
  const groups: Record<string, UnknownRecord[]> = {};
  for (const entry of asArray(root.General)) {
    const raw = asRecord(entry);
    if (!raw) continue;
    const record = expandRecord(raw, abbreviation);
    const key = String(record.generalgroup ?? '');
    if (!key) continue;
    const clone = { ...record };
    if (typeof clone.generalname === 'string') {
      clone.generalname = clone.generalname.replace(/&/g, '');
    }
    (groups[key] ||= []).push(clone);
  }
  // JumpStage 链式 next
  for (const list of Object.values(groups)) {
    for (const general of list) {
      const jump = typeof general.JumpStage === 'string' ? general.JumpStage.split(';') : null;
      if (!jump || jump.length < 2) continue;
      let groupId = jump[0];
      if (groupId.startsWith('2066')) groupId = String(Number(groupId) - 0x4e20);
      const index = Number(jump[1]) - 1;
      const next = groups[groupId]?.[index] ?? groups[groupId]?.[0];
      if (next) general.next = next;
    }
  }
  return groups;
}

function flattenFightLost(general: UnknownRecord | null | undefined, stage: number, isLast: boolean, sink: {
  fight: string;
  lost: string;
  generals: UnknownRecord[];
}): void {
  if (!general) return;
  const info = asRecord(general.info) ?? general;
  sink.fight += String(info.info ?? '');
  sink.lost += `${general.start ? '[先手]' : ''}${String(general.generalname ?? '')}`;
  const next = asRecord(general.next);
  if (next) {
    sink.lost += '>';
    next.stage = stage;
    const nextInfo = asRecord(next.info) ?? (next.info = {});
    asRecord(nextInfo)!.pre = general.generalname;
    sink.generals.push(next);
    flattenFightLost(next, stage + 1, isLast, sink);
  } else if (!isLast) {
    sink.fight += '+';
    sink.lost += ' ';
  }
}

function buildRfight(
  root: UnknownRecord,
  textTable: Record<string, string>,
  generalGroups: Record<string, UnknownRecord[]>,
  rewardNames: Record<string, string>
): Record<string, RogueFightMeta> {
  const table: Record<string, RogueFightMeta> = {};
  for (const entry of asArray(root.Fight)) {
    const record = asRecord(entry);
    if (!record) continue;
    const fightID = record.fightID ?? record.fightId;
    if (fightID == null) continue;
    const groupKey = String(record.Ggroup ?? record.ggroup ?? '');
    const generals = [...(generalGroups[groupKey] ?? [])].map((item) => ({ ...item }));
    if (record.startnum) {
      const starter = generals.find((item) => item.generalID == record.startnum || item.generalId == record.startnum);
      if (starter) starter.start = true;
    }
    const sink = { fight: '', lost: '', generals: [...generals] };
    generals.forEach((general, index, list) => {
      flattenFightLost(general, 1, index === list.length - 1, sink);
    });
    const rewards = [
      ...(record.rewarditem ? String(record.rewarditem).split(';') : []),
      ...String(record.reward ?? '').split(';')
    ]
      .map((id) => rewardNames[id] ?? id)
      .filter(Boolean)
      .join('\n');
    table[String(fightID)] = {
      ...record,
      generals: sink.generals,
      fight: sink.fight,
      lost: sink.lost.trim(),
      get: `${record.itemgroup ?? ''}铜币\n${rewards}`.trim(),
      text: localize(textTable, record.text),
      name: localize(textTable, record.name)
    };
  }
  // 无 Fight 行但有武将组时补空壳
  for (const [key, generals] of Object.entries(generalGroups)) {
    if (!(key in table)) {
      table[key] = {
        generals: [...generals],
        baseGenerals: [...generals]
      } as RogueFightMeta;
    }
  }
  return table;
}

function buildRewardNames(root: UnknownRecord): Record<string, string> {
  const table: Record<string, string> = {};
  // 对照 app.bak：先 Other，再 RewardGroup 覆盖；表名是 RewardGroup 不是 Reward。
  for (const entry of asArray(root.Other)) {
    const record = asRecord(entry);
    if (!record || record.reward == null) continue;
    table[String(record.reward)] = String(record.rewardname ?? '');
  }
  for (const entry of asArray(root.RewardGroup ?? root.Reward ?? root.reward)) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = record.reward ?? record.ID ?? record.id;
    if (id == null) continue;
    const desc = String(record.rewarddesc ?? record.rewardname ?? record.name ?? '');
    const allreward = typeof record.allreward === 'string' ? record.allreward : '';
    const multi = allreward
      ? allreward
        .split(';')
        .map((part) => part?.split(','))
        .map((pair) => (pair?.[0] !== undefined && pair[0] !== ''
          ? ['随机', '普通', '稀有', '史诗', '传说'][Number(pair[0])]
          : ''))
        .filter(Boolean)
        .join('/')
      : '';
    const body = `${multi}${desc.replace('多选一', '自选')}`;
    // 对照实际展示：有放弃铜币时写成「普通装备自选/50铜币」
    const abandon = Number(record.abandonmoney);
    table[String(id)] = Number.isFinite(abandon) && abandon > 0
      ? `${body}/${abandon}铜币`
      : body;
  }
  return table;
}

/** 对照 app.bak `hG`：Tactics + Spell + Card。 */
function buildRplot(root: UnknownRecord, names: RogueMapNameTables = {}): Record<string, RoguePlotMeta> {
  const table: Record<string, RoguePlotMeta> = {};
  for (const entry of asArray(root.Tactics)) {
    const record = asRecord(entry);
    if (!record || record.plot == null) continue;
    table[String(record.plot)] = {
      name: String(record.plotname ?? '').replace(/·/g, ''),
      desc: String(record.plotdesc ?? '').replace(/ /g, ''),
      school: record.school,
      money: record.money,
      level: record.level,
      type: 2
    };
  }
  for (const entry of asArray(root.Spell)) {
    const record = asRecord(entry);
    if (!record || record.id == null) continue;
    const spellId = Number(record.spellid);
    const spell = Number.isFinite(spellId) ? names.spells?.get(spellId) : undefined;
    table[String(record.id)] = {
      name: spell?.name ?? '',
      desc: spell?.desc ?? '',
      spellid: spellId,
      money: record.money,
      level: record.level,
      type: 3
    };
  }
  const subtypeNames: Record<number, string> = {
    6: '火杀',
    7: '雷杀',
    11: '冰杀',
    12: '闪闪'
  };
  for (const entry of asArray(root.Card)) {
    const record = asRecord(entry);
    if (!record || record.id == null) continue;
    const cardId = Number(record.cardid);
    const card = Number.isFinite(cardId) ? names.cards?.get(cardId) : undefined;
    const isEquip = Number(record.isequip) || 0;
    table[String(record.id)] = {
      name: (card?.subType != null && subtypeNames[card.subType])
        || card?.name
        || '',
      desc: card?.desc ?? '',
      money: record.money,
      level: record.level,
      type: 4 + isEquip
    };
  }
  return table;
}

/**
 * 对照 app.bak `Lp`：奇遇选项得失文案。
 * `type,rarity` → 传说战法；否则查 Reward / Rplot / 武将组。
 */
function resolveChooseItem(
  item: unknown,
  count: unknown,
  effectId: unknown,
  rewardNames: Record<string, string>,
  rplot: Record<string, RoguePlotMeta>,
  generalGroups: Record<string, UnknownRecord[]>,
  adventureTitles: Record<string, string>
): string {
  if (item == null || item === '' || item === 0 || item === '0') return '';
  const text = String(item);
  if (text.includes(',')) {
    const [kind, rarity] = text.split(',');
    const rarityName = ['随机', '普通', '稀有', '史诗', '传说'][Number(rarity)] ?? '';
    const kindName = ({ 2: '战法', 3: '技能', 4: '手牌', 5: '装备' } as Record<number, string>)[Number(kind)] ?? '';
    return `${rarityName}${kindName}`;
  }
  const reward = rewardNames[text];
  if (reward) {
    const num = Number(count);
    return (Number.isFinite(num) && num > 1 ? String(num) : '') + reward;
  }
  const plot = rplot[text];
  if (plot?.name) return plot.name;
  const generals = generalGroups[text];
  if (generals?.length) {
    // 对照 Lp：用 effectId/10 反查奇遇章名作缓存键（展示仍用武将名列表）
    void adventureTitles[String(Math.trunc(Number(effectId) / 10))];
    return generals.map((general) => String(general.generalname ?? '')).filter(Boolean).join('\n');
  }
  return text;
}

function buildRchoose(
  root: UnknownRecord,
  rfight: Record<string, RogueFightMeta>,
  rewardNames: Record<string, string>,
  rplot: Record<string, RoguePlotMeta>,
  generalGroups: Record<string, UnknownRecord[]>,
  adventureTitles: Record<string, string>
): Record<string, RogueChooseMeta> {
  const table: Record<string, RogueChooseMeta> = {};
  for (const entry of asArray(root.Choose)) {
    const record = asRecord(entry);
    if (!record) continue;
    const effectID = record.effectID ?? record.effectId;
    if (effectID == null) continue;
    const type = Number(record.type);
    if (type === 7) {
      // 对照 app.bak：奇遇开战选项直接挂 Rfight[event1]（问号关常见）。
      const fight = rfight[String(record.event1)];
      if (fight) table[String(effectID)] = { ...fight };
      else table[String(effectID)] = {};
      continue;
    }
    if (type === 3 && String(record.event1) === '2') {
      table[String(effectID)] = { get: '营地', camp: true };
      continue;
    }
    const lostRaw = resolveChooseItem(
      record.lostitem,
      record.lostnum,
      effectID,
      rewardNames,
      rplot,
      generalGroups,
      adventureTitles
    );
    const getRaw = resolveChooseItem(
      record.getitem,
      record.getnum,
      effectID,
      rewardNames,
      rplot,
      generalGroups,
      adventureTitles
    );
    table[String(effectID)] = {
      lost: lostRaw ? `失去 ${lostRaw}` : '',
      get: getRaw && record.showitem ? getRaw.replace('随机', '特定') : getRaw
    };
  }
  return table;
}

function adventureRecordId(record: UnknownRecord): string | null {
  const id = record.ID ?? record.id;
  return id == null ? null : String(id);
}

function buildRadventure(root: UnknownRecord, textTable: Record<string, string>): Record<string, string> {
  const table: Record<string, string> = {};
  for (const entry of asArray(root.Adventure)) {
    const record = asRecord(entry);
    const id = record ? adventureRecordId(record) : null;
    if (!id) continue;
    table[id] = localize(textTable, record!.chapname ?? record!.chapName);
  }
  return table;
}

function buildRadventureChoices(root: UnknownRecord): Record<string, Array<string | number>> {
  const table: Record<string, Array<string | number>> = {};
  for (const entry of asArray(root.Adventure)) {
    const record = asRecord(entry);
    const id = record ? adventureRecordId(record) : null;
    if (!id) continue;
    table[id] = [record!.effect1, record!.effect2, record!.effect3].filter(
      (value) => value != null
    ) as Array<string | number>;
  }
  return table;
}

function buildRgrow(root: UnknownRecord): Record<string, UnknownRecord> {
  const table: Record<string, UnknownRecord> = {};
  for (const entry of asArray(root.EnemyGrowth)) {
    const record = asRecord(entry);
    if (!record) continue;
    table[`${record.moon}_${record.diffnum}`] = record;
  }
  return table;
}

function buildRnumGrow(root: UnknownRecord): Record<string, UnknownRecord> {
  const table: Record<string, UnknownRecord> = {};
  for (const entry of asArray(root.EnemyNumGrowth)) {
    const record = asRecord(entry);
    if (!record) continue;
    table[`${record.type}_${record.num}`] = record;
  }
  return table;
}

function buildRdiffGrow(root: UnknownRecord): Record<string, UnknownRecord> {
  const table: Record<string, UnknownRecord> = {};
  for (const entry of asArray(root.EnemyDiffGrowth)) {
    const record = asRecord(entry);
    if (!record) continue;
    table[`${record.diffnum}_${record.chap}`] = record;
  }
  return table;
}

function buildRdiff(root: UnknownRecord): Record<string, Record<string, UnknownRecord>> {
  const table: Record<string, Record<string, UnknownRecord>> = {};
  const rows = [
    ...asArray(root.DifficultySelection),
    ...asArray(root.EXDifficultySelection)
  ];
  for (const entry of rows) {
    const record = asRecord(entry);
    if (!record || record.seasonID == null || record.difID == null) continue;
    const season = String(record.seasonID);
    (table[season] ||= {})[String(record.difID)] = record;
  }
  return table;
}

function buildRchapBoss(root: UnknownRecord): Record<string, Record<string, number>> {
  const table: Record<string, Record<string, number>> = {};
  for (const entry of asArray(root.Chapter)) {
    const record = asRecord(entry);
    if (!record || record.seasonID == null) continue;
    const season = String(record.seasonID);
    const chapterId = record.chapter ?? record.chapterID ?? record.chapterId;
    if (chapterId == null) continue;
    const boss = Number(record.bosslocation);
    if (!Number.isFinite(boss)) continue;
    (table[season] ||= {})[String(chapterId)] = boss;
  }
  return table;
}

function emptyConfig(): RogueMapConfigData {
  return {
    Rcity: {},
    Rfight: {},
    Radventure: {},
    RadventureChoices: {},
    Rchoose: {},
    text: {},
    Rplot: {},
    Rreward: {},
    Rgrow: {},
    RnumGrow: {},
    RdiffGrow: {},
    Rdiff: {},
    RchapBoss: {},
    RcurSeason: 0
  };
}

/**
 * 从 `hd_roguelike.sgs` 构建地图透视表。
 * 对照 app.bak：缩写展开、RewardGroup、Rplot(Tactics/Spell/Card)、Lp 解析 Choose、成长表。
 */
export function buildRogueMapConfigData(
  raw: unknown,
  names: RogueMapNameTables = {}
): RogueMapConfigData {
  const root = rootOf(raw);
  if (!root) return emptyConfig();
  const abbreviation = readAbbreviationMap(raw);
  const text = buildTextTable(root);
  const chapterNames = buildChapterNames(root);
  const Rcity = buildRcity(root, chapterNames);
  const generalGroups = buildGeneralGroups(root, abbreviation);
  const Rreward = buildRewardNames(root);
  const Rplot = buildRplot(root, names);
  const Rfight = buildRfight(root, text, generalGroups, Rreward);
  const Radventure = buildRadventure(root, text);
  const RadventureChoices = buildRadventureChoices(root);
  const Rchoose = buildRchoose(root, Rfight, Rreward, Rplot, generalGroups, Radventure);
  const season = asRecord(asArray(root.Season)[0]);
  return {
    Rcity,
    Rfight,
    Radventure,
    RadventureChoices,
    Rchoose,
    text,
    Rplot,
    Rreward,
    Rgrow: buildRgrow(root),
    RnumGrow: buildRnumGrow(root),
    RdiffGrow: buildRdiffGrow(root),
    Rdiff: buildRdiff(root),
    RchapBoss: buildRchapBoss(root),
    RcurSeason: Number(season?.seasonID ?? season?.ID ?? 0) || 0
  };
}

export function isRogueMapConfigReady(data: RogueMapConfigData | null | undefined): boolean {
  return Boolean(data && Object.keys(data.Rcity).length > 0);
}
