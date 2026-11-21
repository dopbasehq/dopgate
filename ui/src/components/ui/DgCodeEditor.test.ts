import { createApp, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import DgCodeEditor from "./DgCodeEditor.vue";

let app: ReturnType<typeof createApp> | null = null;

function mountEditor(initial = "", readonly = false) {
  const value = ref(initial);
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    render: () =>
      h(DgCodeEditor, {
        modelValue: value.value,
        label: "HTML",
        readonly,
        "onUpdate:modelValue": (next: string) => {
          value.value = next;
        },
      }),
  });
  app.mount(host);
  const field = host.querySelector("textarea")!;
  const gutter = () =>
    host.querySelector<HTMLElement>(
      '[data-testid="code-editor-gutter"] > div',
    )!;
  return { value, field, gutter };
}

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("DgCodeEditor", () => {
  it("is named by its label and numbers every line", () => {
    const { field, gutter } = mountEditor("<p>\n  {{code}}\n</p>");
    expect(field.getAttribute("aria-label")).toBe("HTML");
    expect(field.getAttribute("wrap")).toBe("off");
    expect(gutter().textContent).toBe("1\n2\n3");
  });

  it("reports typing and numbers the new lines", async () => {
    const { value, field, gutter } = mountEditor("one");
    field.value = "one\ntwo";
    field.dispatchEvent(new Event("input"));
    await nextTick();
    expect(value.value).toBe("one\ntwo");
    expect(gutter().textContent).toBe("1\n2");
  });

  it("moves the numbers with the text when it scrolls", async () => {
    const { field, gutter } = mountEditor("a\nb\nc");
    field.scrollTop = 40;
    field.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(gutter().style.transform).toBe("translateY(-40px)");
  });

  it("can be read-only", () => {
    const { field } = mountEditor("x", true);
    expect(field.readOnly).toBe(true);
  });
});
