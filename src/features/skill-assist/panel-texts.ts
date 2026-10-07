/** 双雄、吉占、和衷、权道的结果文案。纯函数，只读卡牌元数据。 */
import type { GameCardMetadata } from '../cards/game-card-catalog.ts';
import { compareRanks } from './point-calculators.ts';

type CardFace = Pick<GameCardMetadata, 'name' | 'suit' | 'suitGlyph' | 'rank' | 'cardType'>;

const TRICK_CARD_TYPE = 2;
const DELAYED_TRICK_PREFIXES = ['乐', '兵', '闪电'];
const SHA_NAMES = new Set(['杀', '火杀', '雷杀', '冰杀', '普通杀']);
/** 和衷先比这些锦囊，平了再比第二组。 */
const HEZHONG_PRIMARY = ['无中', '洞烛', '顺手', '过拆', '过河', '逐近', '决斗', '南蛮', '万箭', '出其', '水淹', '随机', '洪荒', '同舟', '力争', '移花'];
const HEZHONG_SECONDARY = ['五谷', '桃园', '火攻', '借刀', '撒豆'];
const RANK_BY_LABEL: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };

/** 把牌点收成可比较的数字。 */
export function rankNumber(card: Pick<GameCardMetadata, 'rank'>): number {
  return RANK_BY_LABEL[card.rank] ?? (Number.parseInt(card.rank, 10) || 0);
}

/** 生成双雄辅助文案。 */
export function formatShuangxiong(cards: readonly CardFace[]): string {
  const red = cards.filter((card) => card.suit === 'heart' || card.suit === 'diamond').length;
  const black = cards.filter((card) => card.suit === 'spade' || card.suit === 'club').length;
  const advice = red > black ? '弃 黑' : red < black ? '弃 红' : '平';
  return `【双雄】${advice}\n${red}红 ${black}黑`;
}

/** 生成击战辅助文案。 */
export function formatJizhan(pivot: number, poolCards: readonly CardFace[]): string {
  const { greater, less, equal } = compareRanks(poolCards.map(rankNumber), pivot);
  return `【吉占】猜${greater > less ? '大' : '小'}\n跟${pivot}比，${greater}张大 ${less}张小 ${equal}平`;
}

/** 生成合纵辅助文案。 */
export function formatHezhong(pivot: number, poolCards: readonly CardFace[]): string {
  const primary = compareByNames(poolCards, HEZHONG_PRIMARY, pivot);
  const secondary = compareByNames(poolCards, HEZHONG_SECONDARY, pivot);
  const advice = primary.greater > primary.less ? '大'
    : primary.greater < primary.less ? '小'
      : secondary.greater > secondary.less ? '大'
        : secondary.greater < secondary.less ? '小'
          : '平';
  return `【和衷】${advice}\n${primary.greater}.${secondary.greater}大 ${primary.less}.${secondary.less}小`;
}

/** 生成权道辅助文案。 */
export function formatQuandao(handCards: readonly CardFace[]): string {
  const sha = handCards.filter((card) => SHA_NAMES.has(card.name)).length;
  const tricks = handCards.filter((card) =>
    card.cardType === TRICK_CARD_TYPE
    && !DELAYED_TRICK_PREFIXES.some((prefix) => card.name.startsWith(prefix))).length;
  return `【权道】杀：普通锦囊\n${sha}：${tricks}`;
}

function compareByNames(cards: readonly CardFace[], prefixes: readonly string[], pivot: number) {
  const matched = cards.filter((card) => prefixes.some((prefix) => card.name.startsWith(prefix)));
  return compareRanks(matched.map(rankNumber), pivot);
}
