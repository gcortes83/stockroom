import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const noComments = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (comment.type === 'Line' && text.startsWith('/ <reference')) continue;
          context.report({ loc: comment.loc, message: 'Comments are not allowed in source files (challenge rule).' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.config.*', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { stockroom: { rules: { 'no-comments': noComments } }, 'react-hooks': reactHooks },
    rules: {
      'stockroom/no-comments': 'error',
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/no-danger': 'off',
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is forbidden.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    plugins: { stockroom: { rules: { 'no-comments': noComments } } },
    rules: { 'stockroom/no-comments': 'error' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['**/src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@nestjs/*', 'pg', 'amqp*', 'fastify'] }],
    },
  },
);
