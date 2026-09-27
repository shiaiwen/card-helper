<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { SkillAssistStore } from '../../features/skill-assist/skill-assist-store.ts';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import { parseSuitToken } from '../../features/skill-assist/quanbian.ts';
import ShoupaiCardFace from './ShoupaiCardFace.vue';

const props = defineProps<{
  skillAssistStore: SkillAssistStore;
  gameCardCatalog: GameCardCatalog;
}>();

const snapshot = ref(props.skillAssistStore.getSnapshot());
const stop = props.skillAssistStore.subscribe((next) => {
  snapshot.value = next;
});
onBeforeUnmount(stop);

const visiblePanels = computed(() =>
  snapshot.value.panels.filter((panel) => panel.visible)
);

function suitParts(token: string) {
  return parseSuitToken(token);
}

const copiedOptionKey = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copyOption(key: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedOptionKey.value = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedOptionKey.value = '';
  }, 500);
}
</script>

<template>
  <section
    v-if="snapshot.inGame && visiblePanels.length"
    class="card-tab-hero-section xc-vue-skill-assist"
  >
    <article
      v-for="panel in visiblePanels"
      :key="panel.id"
      class="xc-hero-block card-tab-panel xc-hero-active"
      :data-feature="panel.id"
    >
      <div
        v-if="panel.showSuitSequence"
        class="card-hero-feature-line"
      >
        <span class="card-detail-feature-title">{{ panel.title }}</span>
        <div class="suitRec" :data-feature-suit="panel.id">
          <span
            v-for="(token, index) in panel.suitTokens"
            :key="`${panel.id}-suit-${index}`"
            class="xc-suit-token"
            :class="[suitParts(token).suitClass, { R: suitParts(token).isRed }]"
          >
            <span class="suit-glyph">{{ suitParts(token).glyph }}</span>{{ suitParts(token).rank }}
          </span>
        </div>
      </div>
      <div
        v-else
        class="card-detail-feature-title"
      >
        {{ panel.title }}
      </div>

      <div
        v-if="panel.shownCardZoneId && panel.cardIds.length"
        class="knownCards quanBianYanXi"
        :data-empty-label="panel.emptyCardLabel || undefined"
      >
        <ShoupaiCardFace
          v-for="cardId in panel.cardIds"
          :key="`${panel.id}-${cardId}`"
          :card-id="cardId"
          :game-card-catalog="gameCardCatalog"
        />
      </div>

      <div
        v-if="panel.showResult && panel.resultText"
        class="function res card-detail-feature-result"
        :data-feature-result="panel.id"
      >
        {{ panel.resultText }}
      </div>

      <div
        v-if="panel.resultOptions.length"
        class="xc-skill-options"
      >
        <button
          v-for="(option, index) in panel.resultOptions"
          :key="`${panel.id}-option-${index}`"
          type="button"
          class="xc-skill-option"
          :class="{ 'xc-skill-option--highlight': panel.highlightedOptions[index] }"
          title="点击复制"
          @click="copyOption(`${panel.id}-${index}`, option)"
        >
          {{ copiedOptionKey === `${panel.id}-${index}` ? '复制成功' : option }}
        </button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.xc-vue-skill-assist {
  width: 100%;
  overflow: hidden;
  clear: both;
}

.xc-hero-block {
  display: block;
  margin: 0 0 6px;
  padding: 6px 8px;
}

.xc-hero-block + .xc-hero-block {
  border-top: 1px solid rgba(242, 222, 156, .25);
}

.card-detail-feature-title {
  margin-bottom: 3px;
  color: #f2de9c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.card-hero-feature-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.card-hero-feature-line .suitRec {
  float: none;
  flex: 1 1 auto;
  width: auto;
  text-align: right;
  min-height: 16px;
}

.xc-suit-token {
  display: inline-block;
  margin-left: 2px;
  font-weight: 700;
  font-size: 12px;
  color: #2c2c2c;
}

.xc-suit-token.R,
.xc-suit-token.suit-heart,
.xc-suit-token.suit-diamond {
  color: #f04155;
}

.xc-suit-token.suit-spade {
  color: #2c2c2c;
}

.xc-suit-token.suit-club {
  color: #787878;
}

.xc-suit-token .suit-glyph {
  font-size: 1.05em;
}

.card-detail-feature-result {
  margin: 4px 0 2px;
  text-align: center;
  color: #f2de9c;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
}

.xc-skill-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 2px;
}

.xc-skill-option {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 6px;
  text-align: center;
  border: 1px solid rgba(201, 161, 93, .55);
  border-radius: 3px;
  background: rgba(34, 27, 19, .85);
  color: #e8d4a8;
  font: 700 12px/1.5 SimSun, serif;
  cursor: pointer;
}

.xc-skill-option--highlight {
  border-color: #f2de9c;
  color: #ffd76a;
}

.xc-skill-option:hover {
  border-color: #c9a15d;
  color: #fff3d0;
  background: rgba(46, 36, 24, .96);
}

.knownCards {
  width: 94%;
  text-align: center;
  position: relative;
  overflow: hidden;
  height: auto;
  min-height: 40px;
  margin: 2px auto 4px;
}

.knownCards::after {
  text-align: center;
  content: attr(data-empty-label);
  position: absolute;
  bottom: 0;
  right: 5px;
  z-index: -1;
  font: 800 20px 'Arial Black', sans-serif;
  color: #f2de9c;
  pointer-events: none;
}
</style>
