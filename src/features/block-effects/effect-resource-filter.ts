export interface EffectResourceFlags {
  sha: boolean;
  heal: boolean;
  interact: boolean;
}

const PLACEHOLDER_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAADklEQVR4AWNgGAWgEAAAAQgAAfZFpq0AAAAASUVORK5CYII=';

/** 只含一根骨骼、贴图为 placeholder.png 的空 DragonBones 动画。 */
const EMPTY_SKELETON = 'data:basic;base64,EwBMQVlBQU5JTUFUSU9OOjEuNy4wBgBEcmFnb24OAHJvb3QKYm9uZQpwbGF5AfwAAAAAAQAAAAIAq6omQgIAAP//AgAAAAAAAAIAq6omQgEAAH9DAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAf0MAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAAAAAAEAAAACAgAAAAAAAgCrqiZCAQAAfkMAAIA/AAAAAAAAAAAAAIA/AACAPwAAgD8AAAAAAAAAAAAAAAABAAB/QwAAgD8AAAAAAAAAAAAAgD8AAIA/AACAPwAAAAAAAAAACAAIAAEAAAAcAHBsYWNlaG9sZGVyLnBuZwpwbGFjZWhvbGRlcgoAAIA/AACAPwAAgEAAAIBAAADAfwAAwH8AAMB/AADAfwEAAgAAAAAAAAACAAQAcm9vdAkAdW5kZWZpbmVkAADAfwAABABib25lBAByb290AADAfwAACAAQAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAgL8AAIC/AAAAAAAAAAAAAAAAAAABAAEAAAAAAQAAAAEAAAAAAAEABABib25lBABib25lBABudWxsAAAeAApib25lCnBsYWNlaG9sZGVyCnBsYWNlaG9sZGVyCgEBAQAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgEAAAIBAAAAAAAAAAAAAAAAAAAAAAA==';

const SHA_EFFECT_PATH = '/res/assets/animate/game/neweffect/EF_Basic_Sha_';
const HEAL_EFFECT_PATH = '/res/assets/animate/game/neweffect/OtherEffect/FX_MatchGame_huixie_';
const HEAL_EFFECT_NAMES = ['FX_', 'xuanhujishi', 'xinglinchunman', 'miaoshouhuichun'];
const INTERACT_EFFECT_NAMES = ['interactProp/fx_uihd_caoxie', 'interactProp/Ol_DaoJu_jidan'];
/** 铁索、酒的骨骼同时承担状态标记，替换后会丢失常驻图标。 */
const PRESERVED_SKELETONS = ['EF_Plot_tiesuo', 'Plot_tiesuolianhuan', 'EFF_jiu', 'EFF_hejiu'];

export function hasAnyEffectResourceBlock(flags: EffectResourceFlags): boolean {
  return flags.sha || flags.heal || flags.interact;
}

function isBlockedSkeleton(path: string, flags: EffectResourceFlags): boolean {
  const sha = flags.sha && path.includes(SHA_EFFECT_PATH);
  const heal = flags.heal && (
    path.includes(HEAL_EFFECT_PATH)
    || HEAL_EFFECT_NAMES.some((name) => path.includes(`res/assets/animate/game/effect/${name}`))
  );
  const interact = flags.interact && INTERACT_EFFECT_NAMES.some((name) => path.includes(`res/assets/animate/${name}`));
  return sha || heal || interact;
}

/** 对应原版 ul：被屏蔽的 .sk 换成空动画，空动画引用的 placeholder.png 换成透明图。 */
export function replaceBlockedEffectUrl(
  url: string,
  flags: EffectResourceFlags,
  baseHref: string = globalThis.location?.href ?? 'http://localhost/'
): string {
  let path: string;
  try {
    path = new URL(url, baseHref).pathname;
  } catch {
    return url;
  }
  if (!path) return url;
  if (path.endsWith('placeholder.png')) return PLACEHOLDER_PNG;
  if (!path.endsWith('.sk') || PRESERVED_SKELETONS.some((name) => path.includes(name))) return url;
  return isBlockedSkeleton(path, flags) ? EMPTY_SKELETON : url;
}
