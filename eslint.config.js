import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', '**/.turbo/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ── Architecture boundaries (ARCHITECTURE.md section 5.3) ──────────────────
  //
  // These are the fast, in-editor half of boundary enforcement. The authoritative
  // graph check is dependency-cruiser (`pnpm graph`), which also catches cycles and
  // deep imports that a per-file lint rule cannot see.
  //
  // eslint-plugin-boundaries was tried first and removed: it matches its element
  // patterns against resolved file paths, and without an import resolver it cannot
  // map a workspace specifier like "@clinic/db" onto packages/db at all — so it
  // silently enforced nothing across packages. A rule that passes when it should
  // fail is worse than no rule, so this uses explicit restricted zones instead.
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clinic/db',
              message:
                'Route handlers and server components call use cases, not the database ' +
                '(section 6). Add a use case in @clinic/core instead.',
            },
            { name: 'mongoose', message: 'The driver belongs in a repository (section 2.4).' },
            { name: 'mongodb', message: 'The driver belongs in a repository (section 2.4).' },
          ],
          patterns: [
            {
              group: ['@clinic/core/*/infrastructure/*', '@clinic/core/*/domain/*'],
              message: 'Import a module through its public entry point (section 5.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom', '@clinic/ui'],
              message:
                'packages/core must never import a framework. This is what makes the mobile ' +
                'API, the worker and every future delivery mechanism possible (section 2.4).',
            },
          ],
        },
      ],
    },
  },
  {
    // Only infrastructure/ may touch the driver.
    // NOTE: flat config REPLACES a rule's options rather than merging them, so the
    // framework patterns from the packages/core block above must be repeated here or
    // they would silently stop applying to these files.
    files: ['packages/core/src/modules/*/{domain,application,policies}/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@clinic/db',
              message:
                'Domain and application layers speak to repositories, not to the driver ' +
                '(section 6). Move this into infrastructure/.',
            },
            { name: 'mongoose', message: 'Mongoose belongs in infrastructure/ only.' },
          ],
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom', '@clinic/ui'],
              message: 'packages/core must never import a framework (section 2.4).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/contracts/**/*.ts', 'packages/ui/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@clinic/core', '@clinic/core/*', '@clinic/db', 'mongoose'],
              message:
                'Shared vocabulary and the design system stay free of business logic and the ' +
                'database, so web and mobile can both depend on them (section 4.1).',
            },
          ],
        },
      ],
    },
  },

  // ── Cross-cutting rules from sections 13.1, 16.1 and 8.15 ──────────────────
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: ['packages/config/**', '**/*.config.{ts,js,mjs}', '**/scripts/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
          message:
            'Read configuration from @clinic/config, never process.env directly (section 13.1). ' +
            'The env schema is parsed once at boot so a missing variable fails fast.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is banned (section 16.1).',
        },
      ],
    },
  },
  {
    // Bulk writes bypass the audit middleware (section 8.15). Repositories only.
    files: ['apps/**/*.{ts,tsx}', 'packages/core/src/modules/*/{domain,application,policies}/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'updateMany', message: 'Bulk writes bypass audit middleware (section 8.15).' },
        { property: 'bulkWrite', message: 'Bulk writes bypass audit middleware (section 8.15).' },
        { property: 'insertMany', message: 'Bulk writes bypass audit middleware (section 8.15).' },
      ],
    },
  },
)
