import { z } from 'zod'

/**
 * The single place in the codebase that reads process.env (section 13.1).
 * Parsed once at boot: the process refuses to start on a missing or malformed
 * variable rather than failing at 2am on the first request that needs it.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * One clinic per installation (ADR-0005). Every request is served for this clinic;
   * resolving the clinic from a hostname instead is the multi-tenant upgrade path.
   */
  CLINIC_ID: z.string().min(1),

  /**
   * Trust X-Forwarded-For only when the app sits behind a proxy you control. Left off,
   * a client could forge the header and dodge per-IP rate limits.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  MONGODB_URI: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
      message: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),
  MONGODB_DB: z.string().min(1),
  MONGODB_AUDIT_URI: z.string().min(1),

  REDIS_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),

  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().email(),

  /**
   * Expo's push relay (§9.4). Optional: a deployment with no mobile app sends no push, and a
   * developer with no device needs nothing configured — `push.send` reports why rather than
   * pretending to have delivered.
   */
  EXPO_ACCESS_TOKEN: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

function readEnv(): Env {
  // Checked via globalThis so this package needs no DOM lib: it is server-only.
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
    throw new Error(
      '@clinic/config holds server-side secrets and must never be imported into a client bundle.',
    )
  }

  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    )
  }
  return parsed.data
}

let cached: Env | undefined

/** Lazy so that importing the package never throws at module-load time in tooling. */
export function env(): Env {
  cached ??= readEnv()
  return cached
}

/** Test-only: forget the parsed value so a new process.env can be read. */
export function resetEnvCache(): void {
  cached = undefined
}
