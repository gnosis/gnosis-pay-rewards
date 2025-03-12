// Import and extract the default property from eslint-config-turbo
const turboConfig = require('eslint-config-turbo');
const turboRecommended = turboConfig.default?.extends || [];

module.exports = {
  extends: [...turboRecommended, 'prettier', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  env: {
    es6: true,
  },
  ignorePatterns: ['node_modules', 'dist', 'build', 'coverage', 'src/**/*.d.ts', 'src/**/generated'],
};
