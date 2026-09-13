import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
  type ResponseConfig,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { APP_VERSION } from '@clinic/config'
import * as contracts from '@clinic/contracts'
import { ACCESS_COOKIE } from '@/lib/auth/cookies'
import { OPERATIONS, type Operation, type OperationResponse } from './catalogue'

/**
 * The OpenAPI 3.1 document for `/api`, generated from the catalogue and the Zod contracts it names
 * (§9.1). For an integrator with no access to `packages/contracts`; the apps import the contracts
 * directly and do not read this (ADR-0032).
 *
 * **What a JSON Schema cannot say, the contract still enforces.** A refinement — a range whose end
 * precedes its start, a decimal's scale — has no JSON Schema form, so the document is a faithful
 * description of the shapes and a looser one of the rules. The server's `422` names the field.
 */

extendZodWithOpenApi(z)

type Schema = z.ZodTypeAny

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' &&
  value !== null &&
  '_def' in value &&
  typeof (value as { safeParse?: unknown }).safeParse === 'function'

/** Each contract by the name it is exported under — which becomes its name in the document. */
const CONTRACT_NAMES = new Map<Schema, string>()
for (const [name, value] of Object.entries(contracts)) {
  if (isSchema(value) && !CONTRACT_NAMES.has(value)) CONTRACT_NAMES.set(value, name)
}

const TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'health', description: 'Liveness and this document.' },
  { name: 'auth', description: 'Signing in and out, refreshing, invitations and password resets.' },
  { name: 'me', description: 'The signed-in person: profile, sessions, devices, notifications.' },
  { name: 'clinic', description: 'Clinic-wide rules any signed-in person may read.' },
  { name: 'admin', description: 'The control plane: settings, branches, roles, users, audit.' },
  { name: 'patients', description: 'The patient register and each chart’s banner.' },
  { name: 'doctors', description: 'Doctors, specialties, weekly hours, time off and open slots.' },
  {
    name: 'appointments',
    description: 'Booking and every transition an appointment goes through.',
  },
  { name: 'encounters', description: 'Visits: the note, vitals, diagnoses, prescriptions, stock.' },
  { name: 'prescriptions', description: 'Prescriptions and their PDFs.' },
  { name: 'files', description: 'Documents: presigned upload, confirmation and download links.' },
  { name: 'billing', description: 'Services, invoices, payments, refunds and statements.' },
  { name: 'inventory', description: 'Items, stock movements, alerts, categories and suppliers.' },
  { name: 'support', description: 'Support tickets and their threads.' },
]

const tagOf = (path: string): string => {
  const [first, second] = path.replace(/^\/api\/(v1\/)?/, '').split('/')
  if (first === 'health' || first === 'openapi.json') return 'health'
  if (first === 'specialties') return 'doctors'
  if (first === 'support' && second) return 'support'
  return first ?? 'health'
}

const pascal = (text: string): string =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('')

/** `POST /api/v1/appointments/{appointmentId}/cancel` → `postAppointmentsByAppointmentIdCancel`. */
export const operationIdOf = (operation: Pick<Operation, 'method' | 'path'>): string =>
  operation.method.toLowerCase() +
  operation.path
    .replace(/^\/api\/(v1\/)?/, '')
    .split('/')
    .map((segment) =>
      segment.startsWith('{') ? `By${pascal(segment.slice(1, -1))}` : pascal(segment),
    )
    .join('')

export const pathParametersOf = (path: string): string[] =>
  [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)

function describe(operation: Operation): string | undefined {
  const parts = [operation.description]
  if (operation.permission) {
    parts.push(
      `Requires \`${operation.permission}\`. The grant’s scope (OWN, ASSIGNED or ALL) narrows what ` +
        'it reaches.',
    )
  }
  if (operation.idempotent) {
    parts.push(
      'Honours `Idempotency-Key`: a retry with the same key and body within 24 hours gets the first ' +
        'response again, marked `idempotent-replayed: true`. The same key with a different body is ' +
        'refused `422 IDEMPOTENCY_KEY_REUSED`; a retry while the first is still running, ' +
        '`409 IDEMPOTENCY_KEY_IN_USE` with `Retry-After`.',
    )
  }
  const text = parts.filter(Boolean).join('\n\n')
  return text === '' ? undefined : text
}

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry()
  const registered = new Map<Schema, Schema>()

  /** A contract as a reference to its component; anything else inline. */
  const ref = (schema: Schema): Schema => {
    const name = CONTRACT_NAMES.get(schema)
    if (name) {
      let component = registered.get(schema)
      if (!component) {
        component = registry.register(name, schema)
        registered.set(schema, component)
      }
      return component
    }
    if (schema instanceof z.ZodArray) return z.array(ref(schema.element as Schema))
    return schema
  }

  const meta = ref(contracts.ResponseMeta)
  const errorEnvelope = ref(contracts.ErrorResponse)

  registry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'The access token a device keeps, from sign-in with `tokenDelivery: "body"`.',
  })
  registry.registerComponent('securitySchemes', 'cookie', {
    type: 'apiKey',
    in: 'cookie',
    name: ACCESS_COOKIE,
    description:
      'The browser’s http-only session cookie. A cookie-authenticated write must come from the ' +
      'same origin.',
  })

  const json = (schema: Schema) => ({ 'application/json': { schema } })
  const replayHeader = {
    'idempotent-replayed': {
      description: 'Present, as `true`, when this is the stored response to an earlier request.',
      schema: { type: 'string' as const, enum: ['true'] },
    },
  }

  function responsesOf(operation: Operation): RouteConfig['responses'] {
    const response: OperationResponse = operation.response
    const success = (description: string, schema: Schema): Record<string, ResponseConfig> =>
      Object.fromEntries(
        response.kind === 'redirect' || response.kind === 'raw'
          ? []
          : response.status.map((status) => [
              String(status),
              {
                description,
                content: json(schema),
                ...(operation.idempotent ? { headers: replayHeader } : {}),
              },
            ]),
      )

    const errors: Record<string, ResponseConfig> = {
      default: {
        description:
          'An error. `error.code` is stable and safe to switch on; `error.message` is for people.',
        content: json(errorEnvelope),
      },
    }

    switch (response.kind) {
      case 'data':
        return {
          ...success('Success.', z.object({ data: ref(response.schema), meta })),
          ...errors,
        }
      case 'page':
        return {
          ...success(
            'One page, in the collection’s stated order. Pass `meta.nextCursor` back as `cursor` ' +
              'for the next; it is null on the last page.',
            z.object({ data: z.array(ref(response.item)), meta }),
          ),
          ...errors,
        }
      case 'cursored':
        return {
          ...success(
            'Success. `meta.nextCursor` continues to older entries; it is null when there are none.',
            z.object({ data: ref(response.schema), meta }),
          ),
          ...errors,
        }
      case 'redirect':
        return { '303': { description: 'A redirect to a page, for a browser.' } }
      case 'raw':
        return {
          '200': {
            description: response.description,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        }
    }
  }

  for (const operation of OPERATIONS) {
    const parameters = pathParametersOf(operation.path)
    const headerEntries: Record<string, Schema> = {}
    if (operation.idempotent) {
      headerEntries['idempotency-key'] = z
        .string()
        .regex(/^[A-Za-z0-9._:-]{8,128}$/)
        .optional()
        .openapi({
          description:
            'Mint one per attempt (a UUID will do) and send the same one when retrying that attempt.',
        })
    }
    for (const [name, header] of Object.entries(operation.headers ?? {})) {
      headerEntries[name] = z.string().optional().openapi({ description: header.description })
    }

    registry.registerPath({
      method: operation.method.toLowerCase() as RouteConfig['method'],
      path: operation.path,
      operationId: operationIdOf(operation),
      tags: [tagOf(operation.path)],
      summary: operation.summary,
      description: describe(operation),
      security:
        operation.auth === 'none'
          ? []
          : operation.auth === 'optional'
            ? [{}, { bearer: [] }, { cookie: [] }]
            : [{ bearer: [] }, { cookie: [] }],
      ...(operation.permission ? { 'x-permission': operation.permission } : {}),
      request: {
        params:
          parameters.length > 0
            ? z.object(Object.fromEntries(parameters.map((name) => [name, z.string().max(64)])))
            : undefined,
        query: operation.query as NonNullable<RouteConfig['request']>['query'],
        headers: Object.keys(headerEntries).length > 0 ? z.object(headerEntries) : undefined,
        body: operation.body ? { required: true, content: json(ref(operation.body)) } : undefined,
      },
      responses: responsesOf(operation),
    })
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Clinic API',
      version: APP_VERSION,
      description:
        'Every response is an envelope: `{ data, meta }` on success, `{ error, meta }` on failure, ' +
        'with `meta.requestId` on both. Collections page with a cursor (§9.2). Money is a decimal ' +
        'string, never a number; instants are ISO 8601 in UTC; calendar dates are `YYYY-MM-DD` in ' +
        'the clinic’s timezone.',
    },
    tags: [...TAGS],
  })
}

let cached: ReturnType<typeof buildOpenApiDocument> | null = null

/** Built once per process: the catalogue and the contracts cannot change while it runs. */
export function openApiDocument() {
  cached ??= buildOpenApiDocument()
  return cached
}
