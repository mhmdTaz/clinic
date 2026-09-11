/**
 * Architecture boundaries — ARCHITECTURE.md section 5.3.
 * A violation here is a build error, not a code-review comment.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      comment: 'Circular dependencies mean the module graph in section 5.2 has been broken.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-is-framework-free',
      comment:
        'packages/core must never import a framework. This is what makes the mobile API, the ' +
        'worker and every future delivery mechanism possible (section 2.4).',
      severity: 'error',
      from: { path: '^packages/core' },
      to: { path: '^(node_modules/)?(next|react|react-dom|@clinic/ui)(/|$)' },
    },
    {
      name: 'no-deep-module-imports',
      comment:
        'Modules talk through their public index.ts only (section 5.1). Reaching into another ' +
        "module's application/, domain/ or infrastructure/ folder is forbidden.",
      severity: 'error',
      from: { path: '^packages/core/src/modules/([^/]+)/' },
      to: { path: '^packages/core/src/modules/(?!$1/)([^/]+)/(?!index\\.ts$).+' },
    },
    {
      name: 'db-only-from-infrastructure',
      comment:
        'A Mongoose model is never imported outside an infrastructure/ folder (section 2.4). ' +
        'Domain and application layers speak to repositories, not to the driver.',
      severity: 'error',
      from: {
        path: '^packages/core/src/modules/[^/]+/(domain|application|policies)/',
      },
      to: { path: '^(@clinic/db|packages/db|node_modules/(@clinic/db|mongoose|mongodb))(/|$)' },
    },
    {
      name: 'apps-never-touch-the-database',
      comment:
        'Route handlers and server components call use cases. They do not open connections or ' +
        'build queries (section 6).',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^(@clinic/db|packages/db|node_modules/(@clinic/db|mongoose|mongodb))(/|$)' },
    },
    {
      name: 'contracts-are-dependency-free',
      comment: 'packages/contracts is the shared vocabulary for web, mobile and server. Zod only.',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: {
        path: '^(@clinic/(core|db|ui)|packages/(core|db|ui)|node_modules/(@clinic/(core|db|ui)|next|react|mongoose))(/|$)',
      },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'An import that cannot be resolved is either a typo or a dependency missing from the ' +
        "package's manifest — which is how a boundary gets crossed by accident.",
      severity: 'error',
      // Skipped: migrations (loaded by migrate-mongo, not imported), and next-env.d.ts.
      // The web app's "@/" alias IS resolved (tsconfig.depcruise.json), so a broken
      // "@/" import fails here like any other.
      from: { pathNot: ['^packages/db/migrations/', 'next-env\\.d\\.ts$'] },
      to: { couldNotResolve: true, pathNot: '^(node:|server-only$)' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '\\.(config|setup[^/]*)\\.(ts|js|mjs|cjs)$', // tool configs are entry points
          '^packages/db/migrations/', // migrate-mongo loads these by convention
          '^packages/[^/]+/src/index\\.ts$', // a package's public API, imported by name
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|\\.next|dist|coverage|__tests__|\\.test\\.ts)' },
    // The base config plus the web app's "@/" path alias. Without it every file reached
    // only through "@/" looks orphaned and a mistyped "@/" import goes unnoticed.
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
