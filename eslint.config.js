// @ts-check
import baseConfig from '@mgcrea/eslint-config-node';

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
        project: ['./tsconfig.json']
      }
    }
  }
];
