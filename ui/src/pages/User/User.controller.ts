import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@pinia/colada";
import { errorMessage } from "~/services/api";
import {
  deleteUser,
  disableUser,
  enableUser,
  revokeUserSessions,
  revokeUserToken,
  sendPasswordReset,
  updateUser,
} from "~/services/admin.api";
import type { AdminUser, PersonalToken } from "~/services/types";
import {
  userAgentsQuery,
  userQuery,
  userSessionsQuery,
  userTokensQuery,
} from "~/queries/admin";
import { useInvalidate } from "~/queries/invalidate";
import { formatJson, parseJsonObject } from "~/utils/json";

/** Actions that ask before they run. */
export type ConfirmKind = "disable" | "delete" | "sign-out-all";

/**
 * User page controller: one of your app's users, with their profile,
 * sessions and metadata, and what an admin may do to them. Every admin
 * manages every user; admins themselves live on the Admins page.
 */
export function useUserController() {
  const route = useRoute();
  const router = useRouter();
  const invalidate = useInvalidate();

  const id = computed(() => String(route.params.id ?? ""));
  const userRead = useQuery(() => userQuery(id.value));
  const sessionsRead = useQuery(() => userSessionsQuery(id.value));
  const tokensRead = useQuery(() => userTokensQuery(id.value));
  const agentsRead = useQuery(() => userAgentsQuery(id.value));

  const user = computed<AdminUser | null>(() => userRead.data.value ?? null);
  const loadError = computed(() =>
    userRead.error.value && !userRead.isLoading.value
      ? errorMessage(userRead.error.value, "Couldn't load this user.")
      : null,
  );
  const sessions = computed(() => sessionsRead.data.value ?? null);
  const sessionsError = computed(() =>
    sessionsRead.error.value
      ? errorMessage(sessionsRead.error.value, "Couldn't load sessions.")
      : null,
  );

  const tokens = computed(() => tokensRead.data.value ?? null);
  const tokensError = computed(() =>
    tokensRead.error.value
      ? errorMessage(tokensRead.error.value, "Couldn't load personal tokens.")
      : null,
  );
  const agents = computed(() => agentsRead.data.value ?? null);
  const agentsError = computed(() =>
    agentsRead.error.value
      ? errorMessage(agentsRead.error.value, "Couldn't load agents.")
      : null,
  );

  // Revoking a personal token asks first.
  const tokenToRevoke = ref<PersonalToken | null>(null);
  const revoking = ref(false);
  const revokeError = ref<string | null>(null);

  function askRevoke(token: PersonalToken): void {
    revokeError.value = null;
    tokenToRevoke.value = token;
  }

  function cancelRevoke(): void {
    if (!revoking.value) tokenToRevoke.value = null;
  }

  async function revokeToken(): Promise<void> {
    const token = tokenToRevoke.value;
    if (!token || revoking.value) return;
    revoking.value = true;
    revokeError.value = null;
    try {
      await revokeUserToken(id.value, token.id);
      tokenToRevoke.value = null;
      notice.value = `Revoked the personal token “${token.name}”.`;
      await invalidate.userTokensChanged(id.value);
    } catch (cause) {
      revokeError.value = errorMessage(cause, "Couldn't revoke the token.");
    } finally {
      revoking.value = false;
    }
  }

  /** Every admin manages every user, once the user has loaded. */
  const canManage = computed(() => user.value !== null);
  const canDisableOrDelete = canManage;

  // Profile and metadata drafts follow the loaded user until edited.
  const displayName = ref("");
  const publicMetadata = ref("{}");
  const privateMetadata = ref("{}");

  // A newer copy of the user replaces each draft that still shows the old
  // value, so saving one section never wipes edits in another.
  watch(
    user,
    (next, previous) => {
      if (!next) return;
      const same = previous?.id === next.id;
      if (!same || displayName.value === (previous?.displayName ?? ""))
        displayName.value = next.displayName ?? "";
      if (
        !same ||
        publicMetadata.value === formatJson(previous?.publicMetadata)
      )
        publicMetadata.value = formatJson(next.publicMetadata);
      if (
        !same ||
        privateMetadata.value === formatJson(previous?.privateMetadata)
      )
        privateMetadata.value = formatJson(next.privateMetadata);
    },
    { immediate: true },
  );

  const userMetadata = computed(() =>
    formatJson(user.value?.userMetadata ?? {}),
  );
  const profileDirty = computed(
    () => (user.value?.displayName ?? "") !== displayName.value.trim(),
  );
  const metadataDirty = computed(() => {
    if (!user.value) return false;
    return (
      publicMetadata.value !== formatJson(user.value.publicMetadata) ||
      privateMetadata.value !== formatJson(user.value.privateMetadata)
    );
  });

  const busy = ref<string | null>(null);
  const error = ref<string | null>(null);
  const notice = ref<string | null>(null);

  async function run(
    name: string,
    action: () => Promise<void>,
    fallback: string,
  ): Promise<boolean> {
    if (busy.value) return false;
    busy.value = name;
    error.value = null;
    notice.value = null;
    try {
      await action();
      return true;
    } catch (cause) {
      error.value = errorMessage(cause, fallback);
      return false;
    } finally {
      busy.value = null;
    }
  }

  async function changed(next: AdminUser): Promise<void> {
    await invalidate.userChanged(next);
  }

  function saveProfile(): Promise<boolean> {
    return run(
      "profile",
      async () => {
        const name = displayName.value.trim();
        const next = await updateUser(id.value, {
          displayName: name === "" ? null : name,
        });
        displayName.value = next.displayName ?? "";
        await changed(next);
        notice.value = "Profile saved.";
      },
      "Couldn't save the profile.",
    );
  }

  /** Why the metadata can't be saved yet, or null when it can. */
  const metadataError = computed(() => {
    const pub = parseJsonObject(publicMetadata.value);
    const priv = parseJsonObject(privateMetadata.value);
    if (!pub.ok) return "Fix the public metadata first.";
    if (!priv.ok) return "Fix the private metadata first.";
    return null;
  });

  function saveMetadata(): Promise<boolean> {
    const pub = parseJsonObject(publicMetadata.value);
    const priv = parseJsonObject(privateMetadata.value);
    if (!pub.ok || !priv.ok) return Promise.resolve(false);
    return run(
      "metadata",
      async () => {
        const next = await updateUser(id.value, {
          publicMetadata: pub.value,
          privateMetadata: priv.value,
        });
        publicMetadata.value = formatJson(next.publicMetadata);
        privateMetadata.value = formatJson(next.privateMetadata);
        await changed(next);
        notice.value = "Metadata saved.";
      },
      "Couldn't save the metadata.",
    );
  }

  function enable(): Promise<boolean> {
    return run(
      "enable",
      async () => {
        await changed(await enableUser(id.value));
        notice.value = "Account turned back on.";
      },
      "Couldn't turn the account on.",
    );
  }

  function markVerified(): Promise<boolean> {
    return run(
      "verify",
      async () => {
        await changed(await updateUser(id.value, { emailVerified: true }));
        notice.value = "Email marked as verified.";
      },
      "Couldn't mark the email as verified.",
    );
  }

  function sendReset(): Promise<boolean> {
    return run(
      "reset",
      async () => {
        await sendPasswordReset(id.value);
        notice.value = `Sent a password reset code to ${user.value?.email ?? "the user"}.`;
      },
      "Couldn't send the reset code.",
    );
  }

  // Confirmed actions
  const confirming = ref<ConfirmKind | null>(null);
  const confirmError = ref<string | null>(null);

  function ask(kind: ConfirmKind): void {
    confirmError.value = null;
    confirming.value = kind;
  }

  function cancelConfirm(): void {
    if (!busy.value) confirming.value = null;
  }

  async function confirm(): Promise<void> {
    const kind = confirming.value;
    if (!kind || busy.value) return;
    busy.value = kind;
    confirmError.value = null;
    error.value = null;
    notice.value = null;
    try {
      if (kind === "disable") {
        await changed(await disableUser(id.value));
        notice.value = "Account turned off. Its sessions have ended.";
      } else if (kind === "sign-out-all") {
        await revokeUserSessions(id.value);
        await sessionsRead.refetch();
        notice.value = "Signed out everywhere.";
      } else {
        await deleteUser(id.value);
        confirming.value = null;
        void invalidate.usersChanged();
        await router.push({ name: "users" });
        return;
      }
      confirming.value = null;
    } catch (cause) {
      confirmError.value = errorMessage(cause, "That didn't work. Try again.");
    } finally {
      busy.value = null;
    }
  }

  async function reload(): Promise<void> {
    await Promise.all([
      userRead.refetch(),
      sessionsRead.refetch(),
      tokensRead.refetch(),
      agentsRead.refetch(),
    ]);
  }

  return {
    id,
    user,
    loadError,
    sessions,
    sessionsError,
    tokens,
    tokensError,
    agents,
    agentsError,
    tokenToRevoke,
    revoking,
    revokeError,
    askRevoke,
    cancelRevoke,
    revokeToken,
    canManage,
    canDisableOrDelete,
    displayName,
    publicMetadata,
    privateMetadata,
    userMetadata,
    profileDirty,
    metadataDirty,
    metadataError,
    busy,
    error,
    notice,
    saveProfile,
    saveMetadata,
    enable,
    markVerified,
    sendReset,
    confirming,
    confirmError,
    ask,
    cancelConfirm,
    confirm,
    reload,
  };
}
