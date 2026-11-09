import { computed, ref } from "vue";
import { useQuery } from "@pinia/colada";
import { ApiError, errorMessage } from "~/services/api";
import {
  createAdmin,
  deleteAdmin,
  disableAdmin,
  enableAdmin,
  type NewAdmin,
} from "~/services/admin.api";
import type { Admin } from "~/services/types";
import { adminsQuery } from "~/queries/admin";
import { useInvalidate } from "~/queries/invalidate";
import { useAuthStore } from "~/stores/auth.store";
import { formatRelativeTime, formatRole } from "~/utils/format";
import { isValidEmail } from "~/utils/validation";

export interface AdminRow {
  admin: Admin;
  name: string | null;
  roleLabel: string;
  lastSignIn: string;
  isYou: boolean;
  /** Root can change every admin but itself. */
  canManage: boolean;
}

export interface NewAdminDraft {
  email: string;
  displayName: string;
  password: string;
}

export type AdminConfirm = { kind: "disable" | "delete"; admin: Admin };

const emptyDraft = (): NewAdminDraft => ({
  email: "",
  displayName: "",
  password: "",
});

/**
 * Admins page controller: root and the admins who run Dopgate. Every admin
 * sees the list; only root adds, turns off, turns on, or removes admins,
 * and root itself can't be changed here.
 */
export function useAdminsController() {
  const auth = useAuthStore();
  const invalidate = useInvalidate();
  const read = useQuery(adminsQuery);

  const canAdd = computed(() => auth.isRoot);
  const rows = computed<AdminRow[] | null>(
    () =>
      read.data.value?.map((admin) => ({
        admin,
        name: admin.displayName,
        roleLabel: formatRole(admin.role),
        lastSignIn: formatRelativeTime(admin.lastSignInAt),
        isYou: admin.id === auth.admin?.id,
        canManage: auth.isRoot && admin.role !== "root",
      })) ?? null,
  );
  const loadError = computed(() =>
    read.error.value && !read.isLoading.value && !read.data.value
      ? errorMessage(read.error.value, "Couldn't load the admins.")
      : null,
  );

  const notice = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const busy = ref(false);

  // Add an admin
  const createOpen = ref(false);
  const draft = ref<NewAdminDraft>(emptyDraft());
  const createErrors = ref<{ email?: string; password?: string }>({});
  const createError = ref<string | null>(null);
  const creating = ref(false);

  function openCreate(): void {
    draft.value = emptyDraft();
    createErrors.value = {};
    createError.value = null;
    createOpen.value = true;
  }

  function closeCreate(): void {
    if (!creating.value) createOpen.value = false;
  }

  async function submitCreate(): Promise<void> {
    if (creating.value || !canAdd.value) return;
    createError.value = null;
    const email = draft.value.email.trim();
    if (email === "") {
      createErrors.value = { email: "Enter an email address." };
      return;
    }
    if (!isValidEmail(email)) {
      createErrors.value = { email: "Enter a valid email address." };
      return;
    }
    createErrors.value = {};
    const body: NewAdmin = { email };
    const displayName = draft.value.displayName.trim();
    if (displayName) body.displayName = displayName;
    if (draft.value.password) body.password = draft.value.password;

    creating.value = true;
    try {
      const created = await createAdmin(body);
      createOpen.value = false;
      notice.value = `Added ${created.email}. They can sign in to this console now.`;
      await invalidate.adminsChanged();
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.hasCode("EMAIL_TAKEN")) {
          createErrors.value = {
            email: "An admin with this email already exists.",
          };
          return;
        }
        if (cause.hasCode("EMAIL_INVALID")) {
          createErrors.value = { email: cause.message };
          return;
        }
        if (cause.hasCode("PASSWORD_INVALID")) {
          createErrors.value = { password: cause.message };
          return;
        }
      }
      createError.value = errorMessage(cause, "Couldn't add the admin.");
    } finally {
      creating.value = false;
    }
  }

  // Turn off, turn on, remove
  const confirm = ref<AdminConfirm | null>(null);

  function ask(kind: AdminConfirm["kind"], admin: Admin): void {
    actionError.value = null;
    confirm.value = { kind, admin };
  }

  function closeConfirm(): void {
    if (!busy.value) confirm.value = null;
  }

  async function run(
    action: () => Promise<unknown>,
    done: string,
    fallback: string,
  ): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    actionError.value = null;
    notice.value = null;
    try {
      await action();
      confirm.value = null;
      notice.value = done;
      await invalidate.adminsChanged();
    } catch (cause) {
      actionError.value = errorMessage(cause, fallback);
    } finally {
      busy.value = false;
    }
  }

  async function confirmAction(): Promise<void> {
    const pending = confirm.value;
    if (!pending) return;
    const { admin } = pending;
    if (pending.kind === "disable") {
      await run(
        () => disableAdmin(admin.id),
        `${admin.email} is turned off and signed out.`,
        "Couldn't turn off the admin.",
      );
    } else {
      await run(
        () => deleteAdmin(admin.id),
        `Removed ${admin.email}.`,
        "Couldn't remove the admin.",
      );
    }
  }

  function enable(admin: Admin): Promise<void> {
    return run(
      () => enableAdmin(admin.id),
      `${admin.email} can sign in again.`,
      "Couldn't turn the admin back on.",
    );
  }

  return {
    rows,
    loadError,
    reload: () => read.refetch(),
    canAdd,
    notice,
    actionError,
    busy,
    createOpen,
    draft,
    createErrors,
    createError,
    creating,
    openCreate,
    closeCreate,
    submitCreate,
    confirm,
    ask,
    closeConfirm,
    confirmAction,
    enable,
  };
}
