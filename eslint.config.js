/**
 * ESLint config for AI Assistant Pro.
 * Flat config format (ESLint v9+).
 *
 * Only lints JavaScript files — TypeScript is checked by `tsc --noEmit`.
 * This keeps eslint fast and avoids duplicating TS type-checking logic.
 */

import js from "@eslint/js";
import prettier from "eslint-config-prettier";

export default [
  // Global ignores
  {
    ignores: [
      "node_modules/",
      ".whisper/",
      "dist/",
      "memory_db/",
      "workspace/",
      "docker/",
      "credentials/",
      "coverage/",
    ],
  },

  // Only lint JavaScript files (TS is handled by tsc --noEmit)
  {
    files: ["**/*.js", "auth.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setImmediate: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        global: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrors: "none",
        varsIgnorePattern: "^(require|_)$",
      }],
      "no-console": "off",
      "no-empty": "warn",
      "no-undef": "off",
    },
  },

  prettier,
];
