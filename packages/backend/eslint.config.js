// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Security: Ban raw Prisma queries to prevent SQL injection
      // Use Prisma's query builder instead for type safety
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/\\$queryRaw|$executeRaw/]',
          message:
            'Raw Prisma queries ($queryRaw, $executeRaw) are prohibited due to SQL injection risk. ' +
            'Use Prisma\'s query builder methods instead. If raw queries are absolutely necessary, ' +
            'consult with the security team and use parameterized queries.',
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  }
);
