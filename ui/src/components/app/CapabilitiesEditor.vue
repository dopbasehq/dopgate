<script setup lang="ts">
import { useId } from "vue";
import { DgButton } from "~/components/ui";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
} from "~/assets/icons";
import {
  CAPABILITY_TYPES,
  emptyRow,
  type CapabilityRow,
} from "~/utils/capabilities";

/**
 * CapabilitiesEditor — an agent's capabilities as rows of key, type, and
 * value, so nobody has to write JSON. When the editor is 512px wide or more
 * (a container query, so a narrow card stacks like a phone does) the column
 * names show once above the rows; below that each row stacks, with the
 * value under the key and type. Every field keeps its own accessible name.
 * Read-only when the viewer isn't the agent's owner.
 */
const props = defineProps<{
  modelValue: CapabilityRow[];
  readonly?: boolean;
  /** Per-row problems, by index. */
  errors?: Record<number, string>;
}>();

const emit = defineEmits<{ "update:modelValue": [rows: CapabilityRow[]] }>();

const id = useId();

const BOOLEAN_OPTIONS = ["true", "false"];

/** Key, type, value, remove. In a narrow editor the value takes its own line. */
const columns =
  "grid-cols-[minmax(0,1fr)_8.5rem_2rem] @lg:grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1.3fr)_2rem]";

const field =
  "w-full rounded-control bg-raised px-3 text-base text-ink-strong outline-none transition-colors duration-150 placeholder:text-ink-faint focus:bg-line";

function change(index: number, patch: Partial<CapabilityRow>): void {
  const rows = props.modelValue.map((row, at) =>
    at === index ? { ...row, ...patch } : row,
  );
  const row = rows[index];
  if (patch.type === "boolean" && row && !["true", "false"].includes(row.value))
    row.value = "true";
  emit("update:modelValue", rows);
}

function add(): void {
  emit("update:modelValue", [...props.modelValue, emptyRow()]);
}

function remove(index: number): void {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, at) => at !== index),
  );
}

function shown(row: CapabilityRow): string {
  return row.type === "list"
    ? row.value.split("\n").filter(Boolean).join(", ")
    : row.value;
}

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

const errorId = (index: number) => `${id}-error-${index}`;
</script>

<template>
  <div class="@container" data-testid="capabilities-editor">
    <div class="flex flex-col gap-3 @lg:gap-2">
      <p v-if="modelValue.length === 0" class="text-sm text-ink-muted">
        No capabilities yet.
      </p>

      <template v-if="readonly">
        <dl
          v-if="modelValue.length > 0"
          class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <template v-for="row in modelValue" :key="row.key">
            <dt class="font-mono text-ink-muted">{{ row.key }}</dt>
            <dd class="break-all font-mono text-ink">{{ shown(row) }}</dd>
          </template>
        </dl>
      </template>

      <template v-else>
        <!-- Column names, once. Each field carries its own name for screen
           readers, so this row is visual only. -->
        <div
          v-if="modelValue.length > 0"
          class="hidden gap-2 text-sm text-ink-muted @lg:grid"
          :class="columns"
          aria-hidden="true">
          <span>Key</span>
          <span>Type</span>
          <span>Value</span>
        </div>

        <div
          v-for="(row, index) in modelValue"
          :key="index"
          class="grid gap-2"
          :class="columns"
          data-testid="capability-row">
          <input
            :value="row.key"
            aria-label="Key"
            placeholder="max_amount"
            autocomplete="off"
            spellcheck="false"
            class="col-start-1 row-start-1 h-9 font-mono sm:text-xs"
            :class="[
              field,
              errors?.[index] ? 'bg-crit/20 focus:bg-crit/25' : '',
            ]"
            :aria-invalid="errors?.[index] ? true : undefined"
            :aria-describedby="errors?.[index] ? errorId(index) : undefined"
            @input="change(index, { key: valueOf($event) })" />

          <div class="relative col-start-2 row-start-1">
            <select
              :value="row.type"
              aria-label="Type"
              class="h-9 cursor-pointer appearance-none pr-8 sm:text-sm"
              :class="field"
              @change="
                change(index, {
                  type: valueOf($event) as CapabilityRow['type'],
                })
              ">
              <option
                v-for="option in CAPABILITY_TYPES"
                :key="option.value"
                :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <ChevronDownIcon
              class="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-ink-faint"
              aria-hidden="true" />
          </div>

          <div
            class="col-span-3 col-start-1 row-start-2 @lg:col-span-1 @lg:col-start-3 @lg:row-start-1">
            <div v-if="row.type === 'boolean'" class="relative">
              <select
                :value="row.value"
                aria-label="Value"
                class="h-9 cursor-pointer appearance-none pr-8 font-mono sm:text-xs"
                :class="field"
                :aria-describedby="errors?.[index] ? errorId(index) : undefined"
                @change="change(index, { value: valueOf($event) })">
                <option
                  v-for="option in BOOLEAN_OPTIONS"
                  :key="option"
                  :value="option">
                  {{ option }}
                </option>
              </select>
              <ChevronDownIcon
                class="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-ink-faint"
                aria-hidden="true" />
            </div>
            <textarea
              v-else-if="row.type === 'list'"
              :value="row.value"
              aria-label="Values"
              placeholder="One per line"
              rows="2"
              spellcheck="false"
              class="block min-h-9 resize-y py-1.5 font-mono leading-5 sm:text-xs"
              :class="field"
              :aria-describedby="errors?.[index] ? errorId(index) : undefined"
              @input="change(index, { value: valueOf($event) })" />
            <input
              v-else
              :value="row.value"
              aria-label="Value"
              :type="row.type === 'number' ? 'number' : 'text'"
              autocomplete="off"
              spellcheck="false"
              class="h-9 font-mono sm:text-xs"
              :class="field"
              :aria-describedby="errors?.[index] ? errorId(index) : undefined"
              @input="change(index, { value: valueOf($event) })" />
          </div>

          <button
            type="button"
            class="col-start-3 row-start-1 flex h-8 w-8 cursor-pointer items-center justify-center self-center rounded-control text-ink-muted transition-colors hover:bg-raised hover:text-ink-strong @lg:col-start-4"
            :aria-label="`Remove ${row.key || 'this capability'}`"
            :title="`Remove ${row.key || 'this capability'}`"
            @click="remove(index)">
            <TrashIcon class="h-4 w-4" />
          </button>

          <p
            v-if="errors?.[index]"
            :id="errorId(index)"
            class="col-span-full flex items-start gap-1.5 text-xs text-crit">
            <AlertTriangleIcon
              class="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true" />
            <span>{{ errors[index] }}</span>
          </p>
        </div>

        <div>
          <DgButton
            variant="ghost"
            size="sm"
            data-testid="add-capability"
            @click="add">
            <PlusIcon class="h-4 w-4" />
            Add capability
          </DgButton>
        </div>
      </template>
    </div>
  </div>
</template>
