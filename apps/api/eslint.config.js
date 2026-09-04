const baseConfig = require("@gym/shared-config/eslint-base");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  ...baseConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
  },
];
