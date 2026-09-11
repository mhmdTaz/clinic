/** Thrown by the tenant guard (section 8.15) — MongoDB has no row-level security. */
export class MissingTenantFilterError extends Error {
  readonly code = 'MISSING_TENANT_FILTER'
  constructor(modelName: string, operation: string) {
    super(
      `${modelName}.${operation}() ran without a clinicId filter. Every tenant-scoped query must ` +
        'be scoped to one clinic. If this query is genuinely global, opt out explicitly with ' +
        '.setOptions({ bypassTenantGuard: true }) and say why in a comment.',
    )
    this.name = 'MissingTenantFilterError'
  }
}

export class MissingTenantFieldError extends Error {
  readonly code = 'MISSING_TENANT_FIELD'
  constructor(modelName: string) {
    super(`A ${modelName} document was saved without a clinicId.`)
    this.name = 'MissingTenantFieldError'
  }
}
