import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    ignores: [
      "node_modules/",
      "src/test/data/",
      "src/helperFunctions/syncWithBackend.ts",
      "src/fileUtils/dart/**",
    ],
    languageOptions: {
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",  // Required for rules that need type information
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-unused-vars": ["error", {
        "args": "none",
        "varsIgnorePattern": "^[A-Z][a-zA-Z]*$" // Ignores PascalCase names (typical for enums)
      }],
      "@typescript-eslint/no-floating-promises": "error",
    },
    extends: [
      pluginJs.configs.recommended,
      ...tseslint.configs.recommended,
      tseslint.configs.strictPromises,  // Adds promise-specific rules
    ],
  }
);