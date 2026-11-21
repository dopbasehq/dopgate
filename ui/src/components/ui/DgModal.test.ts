import { createApp, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import DgInput from "./DgInput.vue";
import DgModal from "./DgModal.vue";

let app: ReturnType<typeof createApp> | null = null;

function mountModal(autofocus: boolean) {
  const open = ref(false);
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    render: () =>
      h(DgModal, { open: open.value, title: "New user" }, () => [
        h(DgInput, { modelValue: "", label: "Name" }),
        h(DgInput, { modelValue: "", label: "Email", autofocus }),
      ]),
  });
  app.mount(host);
  return { open };
}

/** The modal moves focus on the frame after it opens. */
async function nextFrame(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("DgModal", () => {
  it("focuses the input marked autofocus when it opens", async () => {
    const { open } = mountModal(true);
    open.value = true;
    await nextFrame();

    const inputs = [...document.body.querySelectorAll("input")];
    expect(inputs).toHaveLength(2);
    expect(document.activeElement).toBe(inputs[1]);
    // The marker is a data attribute, never the native one.
    expect(inputs[1]?.hasAttribute("autofocus")).toBe(false);
  });

  it("focuses the panel when no input asks for focus", async () => {
    const { open } = mountModal(false);
    open.value = true;
    await nextFrame();

    expect(document.activeElement?.tagName).not.toBe("INPUT");
    expect(
      document.activeElement?.contains(document.querySelector("input")),
    ).toBe(true);
  });
});
