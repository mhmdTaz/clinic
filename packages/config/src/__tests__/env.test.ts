import { describe, expect, it, beforeEach } from 'vitest'
import { env, resetEnvCache } from '../env'

const VALID = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  CLINIC_ID: 'clinic_test',
  MONGODB_URI: 'mongodb://localhost:27017/?replicaSet=rs0',
  MONGODB_DB: 'clinic_test',
  MONGODB_AUDIT_URI: 'mongodb://localhost:27017/?replicaSet=rs0',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'clinic-test',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'no-reply@clinic.local',
}

describe('env', () => {
  beforeEach(() => {
    resetEnvCache()
    for (const key of [...Object.keys(VALID), 'TRUST_PROXY']) delete process.env[key]
  })

  it('parses a complete environment', () => {
    Object.assign(process.env, VALID)
    expect(env().MONGODB_DB).toBe('clinic_test')
    expect(env().S3_REGION).toBe('us-east-1') // default applied
  })

  it('refuses to start when a variable is missing', () => {
    Object.assign(process.env, VALID)
    delete process.env.MONGODB_URI
    expect(() => env()).toThrow(/MONGODB_URI/)
  })

  it('requires the installation clinic id (ADR-0005)', () => {
    Object.assign(process.env, VALID)
    delete process.env.CLINIC_ID
    expect(() => env()).toThrow(/CLINIC_ID/)
  })

  it('rejects a short AUTH_SECRET rather than accepting a weak one', () => {
    Object.assign(process.env, { ...VALID, AUTH_SECRET: 'too-short' })
    expect(() => env()).toThrow(/at least 32 characters/)
  })

  it('rejects a connection string that is not mongodb', () => {
    Object.assign(process.env, { ...VALID, MONGODB_URI: 'postgres://localhost:5432/clinic' })
    expect(() => env()).toThrow(/mongodb/)
  })

  it('does not trust proxy headers unless told to', () => {
    Object.assign(process.env, VALID)
    expect(env().TRUST_PROXY).toBe(false)
  })

  it('parses TRUST_PROXY into a real boolean, not a truthy string', () => {
    Object.assign(process.env, { ...VALID, TRUST_PROXY: 'true' })
    expect(env().TRUST_PROXY).toBe(true)
  })

  it('rejects an ambiguous TRUST_PROXY value', () => {
    Object.assign(process.env, { ...VALID, TRUST_PROXY: 'yes' })
    expect(() => env()).toThrow(/TRUST_PROXY/)
  })
})
