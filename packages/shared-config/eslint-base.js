// Shared ESLint flat-config base for all workspaces.
// Consumers spread this array and append their own env/plugin-specific blocks.
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

/** @type {import("eslint").Linter.Config[]} */
const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
];

module.exports = baseConfig;
