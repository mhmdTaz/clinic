import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contracts from '@clinic/contracts'
import { OPERATIONS, type HttpMethod, type Operation } from '@/lib/api/openapi/catalogue'
import { buildOpenApiDocument, operationIdOf } from '@/lib/api/openapi/document'

/**
 * Phase 10, exit criterion 3: *every route in `apps/web/src/app/api/v1` is in the OpenAPI document,
 * enforced by a test.*
 *
 * A document written beside the code drifts the first week nobody reads it, so this reads the
 * routes themselves. For every exported handler it finds the catalogue entry and checks what a
 * route states in its source: the permission `withApi` checks, the contract its body and query are
 * parsed with, whether it honours an idempotency key, its status codes, and whether it pages. An
 * entry for a route that no longer exists fails too.
 */

const APP = fileURLToPath(new URL('../../app', import.meta.url))

interface RouteExport {
  key: string
  file: string
  method: HttpMethod
  path: string
  /** The object literal passed to `withApi`, or null for a handler written without it. */
  options: string | null
  source: string
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

/** The balanced `{ … }` starting at `start`. */
function objectLiteralAt(text: string, start: number): string {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  throw new Error('unbalanced object literal')
}

function readRoutes(): RouteExport[] {
  return routeFiles(join(APP, 'api')).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const path =
      '/' +
      relative(APP, file)
        .split(sep)
        .slice(0, -1)
        .map((segment) => segment.replace(/^\[(\w+)\]$/, '{$1}'))
        .join('/')

    const exports = [
      ...text.matchAll(
        /export (?:const (GET|POST|PUT|PATCH|DELETE) = withApi\(|(?:async )?function (GET|POST|PUT|PATCH|DELETE)\()/g,
      ),
    ]
    return exports.map((match, index) => {
      const method = (match[1] ?? match[2]) as RouteExport['method']
      const start = match.index ?? 0
      const end = exports[index + 1]?.index ?? text.length
      const source = text.slice(start, end)
      let options: string | null = null
      if (match[1]) {
        const brace = text.indexOf('{', start + match[0].length)
        options = objectLiteralAt(text, brace)
      }
      return { key: `${method} ${path}`, file, method, path, options, source }
    })
  })
}

const ROUTES = readRoutes()
const keyOf = (operation: Pick<Operation, 'method' | 'path'>) =>
  `${operation.method} ${operation.path}`
const CATALOGUE = new Map(OPERATIONS.map((operation) => [keyOf(operation), operation]))

const contract = (name: string): unknown => (contracts as Record<string, unknown>)[name]

describe('the OpenAPI catalogue, against the routes', () => {
  it('found the routes to check', () => {
    // A path mistake here would make every assertion below pass over nothing.
    expect(ROUTES.length).toBeGreaterThan(140)
  })

  it('has one entry per operation', () => {
    const keys = OPERATIONS.map(keyOf)
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([])
  })

  it('describes every route that exists', () => {
    const missing = ROUTES.filter((route) => !CATALOGUE.has(route.key)).map((route) => route.key)
    expect(missing).toEqual([])
  })

  it('describes no route that does not exist', () => {
    const routes = new Set(ROUTES.map((route) => route.key))
    expect(OPERATIONS.map(keyOf).filter((key) => !routes.has(key))).toEqual([])
  })

  it.each(ROUTES.map((route) => [route.key, route] as const))('%s', (_key, route) => {
    const entry = CATALOGUE.get(route.key)
    if (!entry) return // reported once, above

    if (route.options === null) {
      // Written without `withApi`: a browser redirect, or a document served bare.
      expect(entry.auth).toBe('none')
      expect(entry.response.kind).toBe(
        route.source.includes('NextResponse.redirect') ? 'redirect' : 'raw',
      )
      return
    }

    const options = route.options
    expect(entry.auth, 'auth').toBe(options.match(/auth:\s*'(\w+)'/)?.[1] ?? 'required')
    expect(entry.permission, 'permission').toBe(options.match(/permission:\s*'([^']+)'/)?.[1])
    expect(entry.idempotent ?? false, 'idempotent').toBe(/idempotent:\s*true/.test(options))

    for (const part of ['body', 'query'] as const) {
      const name = options.match(new RegExp(`${part}:\\s*(\\w+)`))?.[1]
      if (!name) {
        expect(entry[part], `${part} should be absent`).toBeUndefined()
        continue
      }
      expect(contract(name), `${part} ${name} is a contract`).toBeDefined()
      expect(entry[part] === contract(name), `${part} is ${name}`).toBe(true)
    }

    const statuses = [...route.source.matchAll(/status:\s*([^,\n}]+)/g)]
      .flatMap((match) => match[1]!.match(/\b[1-5]\d\d\b/g) ?? [])
      .map(Number)
    const expected = statuses.length > 0 ? [...new Set(statuses)].sort() : [200]
    const response = entry.response
    if (response.kind === 'redirect' || response.kind === 'raw') {
      throw new Error(`${route.key} uses withApi, so it answers with an envelope`)
    }
    expect([...response.status].sort(), 'status').toEqual(expected)

    const pages = route.source.includes('paged(') || route.source.includes('data: page.items')
    const cursored = !pages && route.source.includes('nextCursor')
    expect(response.kind, 'response kind').toBe(pages ? 'page' : cursored ? 'cursored' : 'data')
  })
})

/**
 * Exit criterion 2: *every collection either returns a `nextCursor` or is listed as bounded
 * reference data.* A list added without a cursor fails here until somebody decides which it is.
 */
const BOUNDED: Record<string, string> = {
  'GET /api/v1/admin/branches': 'A clinic’s branches',
  'GET /api/v1/admin/permissions': 'The permission catalogue, fixed in code',
  'GET /api/v1/admin/roles': 'A clinic’s roles',
  'GET /api/v1/admin/audit-logs/actors': 'The people who appear in the log, for a filter',
  'GET /api/v1/billing/services': 'The price list',
  'GET /api/v1/doctors': 'A clinic’s doctors',
  'GET /api/v1/doctors/{doctorId}/slots': 'Bounded by the date range asked for',
  'GET /api/v1/encounters/{encounterId}/consumption': 'What one visit used',
  'GET /api/v1/inventory/categories': 'Stock categories',
  'GET /api/v1/inventory/suppliers': 'Suppliers',
  'GET /api/v1/me/devices': 'One person’s phones',
  'GET /api/v1/me/notification-preferences': 'One row per kind of event',
  'GET /api/v1/specialties': 'The specialties',
}

describe('collections', () => {
  it('page with a cursor, or are named as bounded reference data', () => {
    const unbounded = OPERATIONS.filter(
      (operation) =>
        // Reads. A write that answers with the rows it replaced is not a collection anybody lists.
        operation.method === 'GET' &&
        operation.response.kind === 'data' &&
        operation.response.schema instanceof z.ZodArray &&
        !(keyOf(operation) in BOUNDED),
    ).map(keyOf)
    expect(unbounded).toEqual([])
  })

  it('name only lists that exist and do not page', () => {
    for (const key of Object.keys(BOUNDED)) {
      const operation = CATALOGUE.get(key)
      expect(operation, key).toBeDefined()
      expect(
        operation?.response.kind === 'data' && operation.response.schema instanceof z.ZodArray,
        key,
      ).toBe(true)
    }
  })
})

describe('the generated document', () => {
  const document = buildOpenApiDocument()
  const operationOf = (entry: Operation) =>
    document.paths?.[entry.path]?.[entry.method.toLowerCase() as 'get']

  it('is OpenAPI 3.1 and survives being serialised', () => {
    expect(document.openapi).toBe('3.1.0')
    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
  })

  it('has every catalogued operation, with a unique id', () => {
    for (const entry of OPERATIONS) {
      expect(operationOf(entry)?.operationId, keyOf(entry)).toBe(operationIdOf(entry))
    }
    const ids = OPERATIONS.map(operationIdOf)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  it('names contracts as components rather than repeating them', () => {
    const schemas = Object.keys(document.components?.schemas ?? {})
    expect(schemas).toEqual(
      expect.arrayContaining(['AppointmentDetail', 'EncounterSummary', 'ResponseMeta']),
    )
  })

  it('documents the idempotency key wherever it is honoured', () => {
    for (const entry of OPERATIONS.filter((operation) => operation.idempotent)) {
      const parameters = (operationOf(entry)?.parameters ?? []) as Array<{
        in: string
        name: string
      }>
      expect(
        parameters.some(
          (parameter) => parameter.in === 'header' && parameter.name === 'idempotency-key',
        ),
        keyOf(entry),
      ).toBe(true)
    }
  })

  it('documents each path parameter', () => {
    const entry = CATALOGUE.get('POST /api/v1/appointments/{appointmentId}/cancel')!
    const parameters = (operationOf(entry)?.parameters ?? []) as Array<{ in: string; name: string }>
    expect(parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ in: 'path', name: 'appointmentId' })]),
    )
  })

  it('reads the visit filter as a query parameter', () => {
    const entry = CATALOGUE.get('GET /api/v1/encounters')!
    const names = ((operationOf(entry)?.parameters ?? []) as Array<{ name: string }>).map(
      (parameter) => parameter.name,
    )
    expect(names).toEqual(expect.arrayContaining(['appointmentIds', 'cursor', 'limit']))
  })

  it('asks for no credentials where none are needed', () => {
    expect(operationOf(CATALOGUE.get('POST /api/v1/auth/login')!)?.security).toEqual([])
    expect(operationOf(CATALOGUE.get('GET /api/v1/me')!)?.security).toEqual([
      { bearer: [] },
      { cookie: [] },
    ])
  })
})
