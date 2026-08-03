import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * RepoCity lint policy.
 *
 * Type-aware rules are on: most of what can still go wrong here after `strict`
 * TypeScript is promise and `any` handling, and those need type information to
 * catch. Formatting is delegated to Prettier -- `eslint-config-prettier` turns
 * off every stylistic rule so the two never disagree.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      'worker-configuration.d.ts',
      'eslint.config.js',
      // Build configs sit outside both tsconfig projects, so the type-aware
      // parser cannot resolve them. They are tiny and typechecked by Vite.
      'vite.config.ts',
      'vitest.worker.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The codebase deliberately uses `void` for fire-and-forget handlers.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // Non-null assertions are used for DOM lookups that index.html guarantees.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // addEventListener with an async listener is the normal browser idiom
      // here; every such handler already contains its own try/catch.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],
      // ApiFailure extends Error, but the rule cannot see through the
      // conditional return type of the factory that produces it.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // No-op stubs stand in for real implementations on empty-city and
      // disposed objects, so the caller never has to null-check.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['methods'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
    },
  },

  // Rejecting control characters in URL state is the point of these patterns.
  {
    files: ['src/core/url-state.ts'],
    rules: { 'no-control-regex': 'off' },
  },

  /*
   * Developer scripts run under Node and sit outside both tsconfig projects,
   * so the type-aware rules cannot resolve them. Lint them syntactically
   * rather than skipping them entirely.
   */
  {
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // Both: the file runs under Node, but its page.evaluate() callbacks are
      // serialised and executed inside the browser.
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },

  // Browser code.
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },

  // Worker code runs on Workerd, which is neither Node nor a browser.
  {
    files: ['worker/**/*.ts'],
    languageOptions: { globals: { ...globals.worker, ...globals.serviceworker } },
  },

  // Tests build deliberately hostile fixtures and stub globals, so the
  // type-safety rules that guard production code only create noise here.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'no-console': 'off',
    },
  },

  prettier,
);
