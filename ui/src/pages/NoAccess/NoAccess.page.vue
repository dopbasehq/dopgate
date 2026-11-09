<script setup lang="ts">
import { FocusLayout } from "~/layouts";
import { DgButton } from "~/components/ui";
import { LockIcon } from "~/assets/icons";
import { useNoAccessController } from "./NoAccess.controller";

const { email, signingOut, signOut } = useNoAccessController();
</script>

<template>
  <FocusLayout>
    <div class="flex flex-col items-start gap-4">
      <div
        class="flex h-11 w-11 items-center justify-center rounded-control border border-line bg-raised text-ink-muted">
        <LockIcon class="h-5 w-5" />
      </div>
      <h1 class="text-xl font-semibold text-ink-strong">
        This console is for admins.
      </h1>
      <p class="text-sm text-ink-muted">
        You're signed in as
        <span class="font-mono text-ink">{{ email }}</span
        >, which is a member account. Ask an admin if you need access.
      </p>
      <DgButton :loading="signingOut" data-testid="sign-out" @click="signOut">
        Sign out
      </DgButton>
    </div>
  </FocusLayout>
</template>
