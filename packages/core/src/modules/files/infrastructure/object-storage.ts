import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env, processSingleton } from '@clinic/config'

/**
 * Object storage (section 12.1). The application never carries the bytes: it issues short-lived
 * presigned URLs and records metadata. Streaming a 40 MB scan through a route handler would hold
 * a request slot for the whole transfer and cap throughput at this server's bandwidth.
 *
 * S3-compatible, so the same code runs against MinIO locally and a real bucket in production.
 */
export interface StoredObjectFacts {
  sizeBytes: number
  mimeType: string | null
  checksumSha256: string | null
}

const box = processSingleton('files:s3', () => ({ client: null as S3Client | null }))

/** Built on first use, not at import: the environment is parsed when the server boots (13.1). */
function s3(): S3Client {
  if (!box.client) {
    const config = env()
    box.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // MinIO serves buckets as a path, not as a subdomain; real S3 accepts both.
      forcePathStyle: true,
    })
  }
  return box.client
}

export const objectStorage = {
  bucket: (): string => env().S3_BUCKET,

  /**
   * A URL the client may PUT to.
   *
   * The content type and length go into the signed request, but S3 does **not** include them in
   * what the signature covers for a presigned PUT — a client can send whatever it likes and
   * storage will take it. That was tested against MinIO, not assumed. What the URL really
   * limits is *where* the bytes may go and *for how long*; what they are is checked on confirm,
   * against the bytes themselves (domain/sniff.ts).
   */
  async presignPut(
    key: string,
    options: { mimeType: string; sizeBytes: number; expiresInSeconds: number },
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const url = await getSignedUrl(
      s3(),
      new PutObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: key,
        ContentType: options.mimeType,
        ContentLength: options.sizeBytes,
      }),
      { expiresIn: options.expiresInSeconds },
    )
    return { url, headers: { 'content-type': options.mimeType } }
  },

  /** A URL the client may GET, naming the file as it was uploaded rather than as a key. */
  presignGet(
    key: string,
    options: { fileName: string; mimeType: string; expiresInSeconds: number },
  ): Promise<string> {
    return getSignedUrl(
      s3(),
      new GetObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: key,
        ResponseContentType: options.mimeType,
        // Quoted, and quotes stripped from the name: a filename can otherwise end the header.
        ResponseContentDisposition: `attachment; filename="${options.fileName.replace(/["\\]/g, '')}"`,
      }),
      { expiresIn: options.expiresInSeconds },
    )
  },

  /** What storage actually received. A client's claim about its own upload is only a claim. */
  async describe(key: string): Promise<StoredObjectFacts | null> {
    try {
      const head = await s3().send(
        new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ChecksumMode: 'ENABLED' }),
      )
      return {
        sizeBytes: head.ContentLength ?? 0,
        mimeType: head.ContentType ?? null,
        checksumSha256: head.ChecksumSHA256 ?? null,
      }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  },

  /** Writing an object the server produced itself, like a rendered prescription (ADR-0026). */
  async put(key: string, body: Uint8Array, mimeType: string): Promise<void> {
    await s3().send(
      new PutObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: body.byteLength,
      }),
    )
  },

  /** The first bytes of an object, for identifying what was actually uploaded (12.3). */
  async readPrefix(key: string, bytes: number): Promise<Uint8Array> {
    const object = await s3().send(
      new GetObjectCommand({
        Bucket: env().S3_BUCKET,
        Key: key,
        Range: `bytes=0-${Math.max(0, bytes - 1)}`,
      }),
    )
    const body = await object.Body?.transformToByteArray()
    return body ?? new Uint8Array()
  },

  async remove(key: string): Promise<void> {
    await s3().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }))
  },
}

function isNotFound(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  const name = (error as { name?: string })?.name
  return status === 404 || name === 'NotFound' || name === 'NoSuchKey'
}
