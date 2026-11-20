<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

/**
 * DgCodeEditor — a monospace text box with line numbers, for code such as
 * email HTML. Lines don't wrap, so each number sits beside its own line;
 * long lines scroll sideways. The box grows with its content from `rows`
 * lines, and the numbers follow if the box scrolls. `label` names it for
 * screen readers. Presentation-only.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    /** The height, in lines, of an empty or short document. */
    rows?: number;
    readonly?: boolean;
    disabled?: boolean;
  }>(),
  { rows: 16, readonly: false, disabled: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const field = ref<HTMLTextAreaElement | null>(null);
const scrollTop = ref(0);

const lineCount = computed(() => props.modelValue.split("\n").length);
const numbers = computed(() =>
  Array.from({ length: lineCount.value }, (_, index) => index + 1).join("\n"),
);

/** Grow to fit the text, so the page scrolls rather than the box. */
function fit(): void {
  const el = field.value;
  if (!el) return;
  el.style.height = "auto";
  // offsetHeight - clientHeight is the border plus a sideways scrollbar.
  const chrome = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + chrome}px`;
  scrollTop.value = el.scrollTop;
}

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function onScroll(event: Event): void {
  scrollTop.value = (event.target as HTMLTextAreaElement).scrollTop;
}

watch(
  () => props.modelValue,
  () => void nextTick(fit),
);
onMounted(fit);
</script>

<template>
  <div
    class="flex min-w-0 bg-editor transition-colors duration-150 focus-within:bg-raised/60"
    :class="disabled ? 'opacity-50' : ''">
    <div
      class="shrink-0 select-none overflow-hidden border-r border-line-soft py-3 pl-4 pr-3 text-right font-mono text-xs leading-5 text-ink-faint tabular-nums"
      aria-hidden="true"
      data-testid="code-editor-gutter">
      <div
        class="whitespace-pre"
        :style="{ transform: `translateY(${-scrollTop}px)` }"
        v-text="numbers" />
    </div>
    <textarea
      ref="field"
      :value="modelValue"
      :rows="rows"
      :aria-label="label"
      :readonly="readonly"
      :disabled="disabled"
      wrap="off"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      class="block min-w-0 flex-1 resize-none overflow-x-auto overflow-y-hidden whitespace-pre bg-transparent py-3 pl-3 pr-4 font-mono text-base leading-5 text-ink-strong outline-none sm:text-xs disabled:cursor-default"
      @input="onInput"
      @scroll="onScroll" />
  </div>
</template>

<style scoped>
textarea {
  font-variant-ligatures: none;
  tab-size: 2;
}
</style>
