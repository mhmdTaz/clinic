import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id with the OWASP-recommended baseline: 19 MiB of memory, 2 iterations, one
 * lane. The algorithm defaults to argon2id in @node-rs/argon2.
 *
 * The parameters are encoded in every hash, so raising them later needs no migration:
 * needsRehash() spots an old hash at the next successful sign-in and it is replaced
 * then, while the plaintext is briefly in hand.
 */
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const
const CURRENT_PREFIX = `$argon2id$v=19$m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}$`

let dummyHash: Promise<string> | null = null

export const passwordHasher = {
  hash(password: string): Promise<string> {
    return hash(password, PARAMS)
  },

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password)
    } catch {
      // A malformed stored hash is a failed verification, not a crash on the sign-in page.
      return false
    }
  },

  needsRehash(passwordHash: string): boolean {
    return !passwordHash.startsWith(CURRENT_PREFIX)
  },

  /**
   * Spends the same time as a real verification. Without it, "no such account" would
   * answer in a millisecond and "wrong password" in fifty, and the difference alone
   * would tell an attacker which emails exist.
   */
  async burnVerificationTime(password: string): Promise<void> {
    dummyHash ??= hash('timing-equaliser-not-a-real-password', PARAMS)
    await verify(await dummyHash, password).catch(() => false)
  },
}
