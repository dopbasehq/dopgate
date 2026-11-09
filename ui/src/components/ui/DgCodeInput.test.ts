import { createApp, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import DgCodeInput from "./DgCodeInput.vue";

let app: ReturnType<typeof createApp> | null = null;

function mountInput(initial = "", error: string | null = null) {
  const value = ref(initial);
  const completed: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    render: () =>
      h(DgCodeInput, {
        modelValue: value.value,
        error,
        "onUpdate:modelValue": (next: string) => {
          value.value = next;
        },
        onComplete: (code: string) => completed.push(code),
      }),
  });
  app.mount(host);
  const boxes = () => [...host.querySelectorAll("input")];
  return { host, value, completed, boxes };
}

function type(box: HTMLInputElement, text: string): void {
  box.value = text;
  box.dispatchEvent(new Event("input"));
}

function paste(box: HTMLInputElement, text: string): void {
  const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  box.dispatchEvent(event);
}

function press(box: HTMLInputElement, key: string): void {
  box.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
}

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("DgCodeInput", () => {
  it("draws six digit boxes in two groups of three", () => {
    const { host, boxes } = mountInput();
    expect(boxes()).toHaveLength(6);
    expect(host.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);
    expect(boxes()[0]?.getAttribute("aria-label")).toBe(
      "Code, character 1 of 6",
    );
    expect(boxes()[0]?.getAttribute("inputmode")).toBe("numeric");
    expect(boxes()[0]?.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("takes digits, skips anything else, and moves to the next box", async () => {
    const { value, boxes } = mountInput();
    type(boxes()[0]!, "4");
    await nextTick();
    expect(value.value).toBe("4");
    await nextTick();
    expect(document.activeElement).toBe(boxes()[1]);

    type(boxes()[1]!, "x");
    await nextTick();
    expect(value.value).toBe("4");
  });

  it("fills every box from a pasted code with spaces or a dash", async () => {
    const { value, completed, boxes } = mountInput();
    paste(boxes()[2]!, " 123-456 ");
    await nextTick();
    expect(value.value).toBe("123456");
    expect(completed).toEqual(["123456"]);
    expect(
      boxes()
        .map((box) => box.value)
        .join(""),
    ).toBe("123456");
  });

  it("moves back and clears with Backspace", async () => {
    const { value, boxes } = mountInput("123");
    await nextTick();
    press(boxes()[3]!, "Backspace");
    await nextTick();
    expect(value.value).toBe("12");
    expect(document.activeElement).toBe(boxes()[2]);
    press(boxes()[1]!, "Backspace");
    await nextTick();
    expect(value.value).toBe("1");
  });

  it("reports completion once the last box is typed", async () => {
    const { completed, boxes } = mountInput("12345");
    await nextTick();
    type(boxes()[5]!, "6");
    await nextTick();
    expect(completed).toEqual(["123456"]);
  });

  it("shows an error with an icon", () => {
    const { host } = mountInput("", "This code has expired.");
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This code has expired.");
    expect(alert?.querySelector("svg")).not.toBeNull();
    expect(host.querySelector("input")?.getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});
