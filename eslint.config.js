// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*'],
  },
  {
    // Server code reads API keys. Only API routes (and tests) may import it, so it
    // can never end up in the iOS app bundle.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/**', 'src/app/**/*+api.ts', 'src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server', '@/server/*', '**/server/*'],
              message: 'Server-only code must not be imported by the app (it handles API keys).',
            },
          ],
        },
      ],
    },
  },
]);
