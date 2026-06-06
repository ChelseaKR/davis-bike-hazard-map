/**
 * Photo blob storage, kept OUT of the JSON/record store.
 *
 * The interface is async because the production adapter (S3PhotoStore) does
 * network I/O — object storage + a CDN takes large, immutable photos off the
 * app's local disk so app instances stay stateless and horizontally scalable.
 * Memory/File adapters satisfy it trivially for tests and single-node dev.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export interface PhotoStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
}

/** Ids are server-generated (UUID + `-thumb`); reject anything else. */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`unsafe photo id: ${id}`);
}

export class MemoryPhotoStore implements PhotoStore {
  private blobs = new Map<string, Uint8Array>();

  async put(id: string, bytes: Uint8Array): Promise<void> {
    this.blobs.set(id, bytes);
  }
  async get(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async has(id: string): Promise<boolean> {
    return this.blobs.has(id);
  }
  async delete(id: string): Promise<void> {
    this.blobs.delete(id);
  }
}

/** One file per photo, written atomically (temp + rename). */
export class FilePhotoStore implements PhotoStore {
  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    assertSafeId(id);
    return join(this.dir, id);
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    const dest = this.path(id);
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
  }
  async get(id: string): Promise<Uint8Array | null> {
    const p = this.path(id);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  }
  async has(id: string): Promise<boolean> {
    return existsSync(this.path(id));
  }
  async delete(id: string): Promise<void> {
    rmSync(this.path(id), { force: true });
  }
}

export interface S3Options {
  bucket: string;
  /** Key prefix within the bucket (e.g. "photos/"). */
  prefix?: string;
  /** Custom endpoint for S3-compatible stores (Cloudflare R2, MinIO). */
  endpoint?: string;
  region?: string;
  /** Inject a client (tests). Otherwise built from the env/default chain. */
  client?: S3Client;
}

/** S3 / S3-compatible (R2, MinIO) object storage. */
export class S3PhotoStore implements PhotoStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(opts: S3Options) {
    this.bucket = opts.bucket;
    this.prefix = opts.prefix ?? 'photos/';
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region ?? 'auto',
        ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
      });
  }

  private key(id: string): string {
    assertSafeId(id);
    return `${this.prefix}${id}`;
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id),
        Body: bytes,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=3600',
      }),
    );
  }

  async get(id: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id) }),
      );
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;
      return await body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async has(id: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export interface PhotoStoreOptions {
  /** S3 bucket name. When set, object storage is used. */
  s3Bucket?: string;
  s3Prefix?: string;
  s3Endpoint?: string;
  s3Region?: string;
  /** JSON store path (file-backed photos beside it). */
  dataFile?: string;
}

/** Build the photo store: S3 when a bucket is configured, else file, else memory. */
export function createPhotoStore(opts: PhotoStoreOptions): PhotoStore {
  if (opts.s3Bucket) {
    return new S3PhotoStore({
      bucket: opts.s3Bucket,
      prefix: opts.s3Prefix,
      endpoint: opts.s3Endpoint,
      region: opts.s3Region,
    });
  }
  if (opts.dataFile) return new FilePhotoStore(join(dirOf(opts.dataFile), 'photos'));
  return new MemoryPhotoStore();
}

function dirOf(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx === -1 ? '.' : file.slice(0, idx);
}
