// @ts-check
import baseConfig from "@mgcrea/eslint-config-node";

/**
 * Eslint configuration
 * @see https://eslint.org/docs/latest/use/configure/
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
      },
    },
    rules: {
      // Homebridge uses callback-based async patterns that trigger this rule
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            arguments: false,
          },
        },
      ],
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // Template expressions with unknown types are common in debug logging
      "@typescript-eslint/restrict-template-expressions": "warn",
      // Non-null assertions are used intentionally after Map.has() checks
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Unnecessary conditions can occur due to runtime vs compile-time type differences
      "@typescript-eslint/no-unnecessary-condition": "warn",
    },
  },
];
