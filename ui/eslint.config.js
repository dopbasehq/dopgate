import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const parentImports = {
  group: ["../*", "../**"],
  message:
    "Parent directory imports are forbidden. Use local files (./) or absolute aliases (~/).",
};

export default [
  { ignores: ["coverage/", "dist/"] },
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      "vue/multi-word-component-names": "off",
      "no-restricted-imports": ["error", { patterns: [parentImports] }],
    },
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["src/components/ui/**"],
    rules: {
      // UI atoms stay dumb: no stores, services, queries or pages.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            parentImports,
            {
              group: [
                "~/stores",
                "~/stores/*",
                "~/services",
                "~/services/*",
                "~/pages",
                "~/pages/*",
                "~/queries",
                "~/queries/*",
                "~/router",
                "@pinia/colada",
              ],
              message:
                "UI components must be presentation-only and cannot import business logic.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
];
