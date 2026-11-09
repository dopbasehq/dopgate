<script setup lang="ts">
import { useId } from "vue";
import { DopgateIcon } from "~/assets/icons";

/**
 * AuthArtwork — the picture beside the sign-in form: nested rounded
 * frames closing in on the dopgate mark, like doors to pass through. Drawn
 * from the Dopbase vault artwork on an 880×900 frame and coloured from the
 * theme tokens, so it follows the brand. It scales with the aside, capped
 * at the viewport height.
 */
const glowId = `auth-glow-${useId()}`;

/** Artwork frame pixels to a length that scales with the container. */
const px = (value: number) => `calc(${value} * 100cqw / 880)`;
</script>

<template>
  <div
    class="@container relative aspect-[880/900] w-[min(100%,880px,calc(100svh*880/900))]"
    data-testid="auth-artwork">
    <svg
      class="absolute inset-0 size-full text-brand-mark"
      viewBox="0 0 880 900"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true">
      <defs>
        <radialGradient
          :id="glowId"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(440 400) scale(380 380)">
          <stop style="stop-color: var(--color-accent)" stop-opacity="0.34" />
          <stop
            offset="1"
            style="stop-color: var(--color-accent)"
            stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="880" height="900" :fill="`url(#${glowId})`" />
      <path
        d="M263 60H617C707.022 60 780 132.978 780 223V577C780 667.022 707.022 740 617 740H263C172.978 740 100 667.022 100 577V223C100 132.978 172.978 60 263 60Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.1" />
      <path
        d="M284 100H596C675.529 100 740 164.471 740 244V556C740 635.529 675.529 700 596 700H284C204.471 700 140 635.529 140 556V244C140 164.471 204.471 100 284 100Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.2" />
      <path
        d="M305 140H575C644.036 140 700 195.964 700 265V535C700 604.036 644.036 660 575 660H305C235.964 660 180 604.036 180 535V265C180 195.964 235.964 140 305 140Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.3" />
      <path
        d="M326 180H554C612.542 180 660 227.458 660 286V514C660 572.542 612.542 620 554 620H326C267.458 620 220 572.542 220 514V286C220 227.458 267.458 180 326 180Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.4" />
      <path
        d="M346 220H534C581.496 220 620 258.504 620 306V494C620 541.496 581.496 580 534 580H346C298.504 580 260 541.496 260 494V306C260 258.504 298.504 220 346 220Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.5" />
      <path
        d="M367 260H513C550.003 260 580 289.997 580 327V473C580 510.003 550.003 540 513 540H367C329.997 540 300 510.003 300 473V327C300 289.997 329.997 260 367 260Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.6" />
      <path
        d="M388 300H492C518.51 300 540 321.49 540 348V452C540 478.51 518.51 500 492 500H388C361.49 500 340 478.51 340 452V348C340 321.49 361.49 300 388 300Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-opacity="0.7" />
      <path
        d="M100 250H98C94.6863 250 92 252.686 92 256V314C92 317.314 94.6863 320 98 320H100C103.314 320 106 317.314 106 314V256C106 252.686 103.314 250 100 250Z"
        fill="currentColor"
        fill-opacity="0.45" />
      <path
        d="M100 520H98C94.6863 520 92 522.686 92 526V584C92 587.314 94.6863 590 98 590H100C103.314 590 106 587.314 106 584V526C106 522.686 103.314 520 100 520Z"
        fill="currentColor"
        fill-opacity="0.45" />
      <path
        d="M610 404C612.209 404 614 402.209 614 400C614 397.791 612.209 396 610 396C607.791 396 606 397.791 606 400C606 402.209 607.791 404 610 404Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M560.2 524.2C562.409 524.2 564.2 522.409 564.2 520.2C564.2 517.991 562.409 516.2 560.2 516.2C557.991 516.2 556.2 517.991 556.2 520.2C556.2 522.409 557.991 524.2 560.2 524.2Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M440 574C442.209 574 444 572.209 444 570C444 567.791 442.209 566 440 566C437.791 566 436 567.791 436 570C436 572.209 437.791 574 440 574Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M319.8 524.2C322.009 524.2 323.8 522.409 323.8 520.2C323.8 517.991 322.009 516.2 319.8 516.2C317.591 516.2 315.8 517.991 315.8 520.2C315.8 522.409 317.591 524.2 319.8 524.2Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M270 404C272.209 404 274 402.209 274 400C274 397.791 272.209 396 270 396C267.791 396 266 397.791 266 400C266 402.209 267.791 404 270 404Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M319.8 283.8C322.009 283.8 323.8 282.009 323.8 279.8C323.8 277.591 322.009 275.8 319.8 275.8C317.591 275.8 315.8 277.591 315.8 279.8C315.8 282.009 317.591 283.8 319.8 283.8Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M440 234C442.209 234 444 232.209 444 230C444 227.791 442.209 226 440 226C437.791 226 436 227.791 436 230C436 232.209 437.791 234 440 234Z"
        fill="currentColor"
        fill-opacity="0.6" />
      <path
        d="M560.2 283.8C562.409 283.8 564.2 282.009 564.2 279.8C564.2 277.591 562.409 275.8 560.2 275.8C557.991 275.8 556.2 277.591 556.2 279.8C556.2 282.009 557.991 283.8 560.2 283.8Z"
        fill="currentColor"
        fill-opacity="0.6" />
    </svg>
    <div
      class="absolute flex items-center justify-center"
      :style="{ left: px(388), top: px(348), width: px(104), height: px(104) }">
      <DopgateIcon class="h-[81.25%] w-auto" />
    </div>
    <p
      class="absolute whitespace-nowrap font-semibold leading-[normal] text-ink-strong"
      :style="{
        left: px(80),
        top: px(788),
        fontSize: px(30),
        letterSpacing: px(-0.6),
      }">
      Every sign-in goes through one gate.
    </p>
  </div>
</template>
