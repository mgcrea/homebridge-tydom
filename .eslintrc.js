module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    // 'airbnb',
    'plugin:@typescript-eslint/recommended',
    'prettier',
    'prettier/@typescript-eslint'
  ],
  plugins: ['@typescript-eslint', 'prettier'],
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module'
  },
  env: {
    es6: true,
    node: true
  },
  rules: {
    '@typescript-eslint/array-type': 'off',
    '@typescript-eslint/ban-ts-ignore': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-member-accessibility': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-inferrable-types': ['error', {ignoreParameters: true, ignoreProperties: true}],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-use-before-define': 'off',
    '@typescript-eslint/prefer-interface': 'off'
  },
  ignorePatterns: ['lib/', 'node_modules/']
};
