import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
      globals: {
        // Add any global variables your project uses
      },
    },
    rules: {
      // Add custom rules here
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '**/*.d.ts', '**/generated/**', '.turbo/**'],
  },
];
