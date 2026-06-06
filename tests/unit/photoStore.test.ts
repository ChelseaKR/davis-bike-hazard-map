import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  MemoryPhotoStore,
  FilePhotoStore,
  S3PhotoStore,
  createPhotoStore,
} from '../../server/lib/photoStore.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

describe('MemoryPhotoStore', () => {
  it('round-trips, reports presence, and deletes', async () => {
    const store = new MemoryPhotoStore();
    expect(await store.get('a')).toBeNull();
    expect(await store.has('a')).toBe(false);
    await store.put('a', bytes('hello'));
    expect(await store.has('a')).toBe(true);
    expect(dec(await store.get('a'))).toBe('hello');
    await store.delete('a');
    expect(await store.has('a')).toBe(false);
  });
});

describe('FilePhotoStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dbhm-photos-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists bytes to disk and round-trips them', async () => {
    const store = new FilePhotoStore(join(dir, 'photos'));
    await store.put('11111111-1111-4111-8111-111111111111', bytes('jpegdata'));
    expect(dec(await store.get('11111111-1111-4111-8111-111111111111'))).toBe('jpegdata');
    expect(readdirSync(join(dir, 'photos')).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('rejects unsafe ids (path-traversal guard)', async () => {
    const store = new FilePhotoStore(join(dir, 'photos'));
    await expect(store.put('../evil', bytes('x'))).rejects.toThrow(/unsafe photo id/);
  });
});

describe('S3PhotoStore', () => {
  const s3mock = mockClient(S3Client);
  beforeEach(() => s3mock.reset());

  it('puts under the prefixed key', async () => {
    s3mock.on(PutObjectCommand).resolves({});
    const store = new S3PhotoStore({ bucket: 'b', prefix: 'photos/', client: s3mock as unknown as S3Client });
    await store.put('id1', bytes('x'));
    const call = s3mock.commandCalls(PutObjectCommand)[0];
    expect(call.args[0].input).toMatchObject({ Bucket: 'b', Key: 'photos/id1', ContentType: 'image/jpeg' });
  });

  it('gets bytes back', async () => {
    s3mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => bytes('img') } as never,
    });
    const store = new S3PhotoStore({ bucket: 'b', client: s3mock as unknown as S3Client });
    expect(dec(await store.get('id1'))).toBe('img');
  });

  it('returns null when the object is missing', async () => {
    s3mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey' });
    const store = new S3PhotoStore({ bucket: 'b', client: s3mock as unknown as S3Client });
    expect(await store.get('missing')).toBeNull();
  });

  it('has() uses HEAD and maps 404 to false', async () => {
    s3mock.on(HeadObjectCommand).resolves({});
    const store = new S3PhotoStore({ bucket: 'b', client: s3mock as unknown as S3Client });
    expect(await store.has('id1')).toBe(true);
    s3mock.on(HeadObjectCommand).rejects({ $metadata: { httpStatusCode: 404 } });
    expect(await store.has('id1')).toBe(false);
  });

  it('deletes via DeleteObjectCommand', async () => {
    s3mock.on(DeleteObjectCommand).resolves({});
    const store = new S3PhotoStore({ bucket: 'b', client: s3mock as unknown as S3Client });
    await store.delete('id1');
    expect(s3mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
});

describe('createPhotoStore', () => {
  it('is in-memory with no config', () => {
    expect(createPhotoStore({})).toBeInstanceOf(MemoryPhotoStore);
  });
  it('is file-backed when a data file is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbhm-cps-'));
    try {
      expect(createPhotoStore({ dataFile: join(dir, 'hazards.json') })).toBeInstanceOf(FilePhotoStore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('is S3-backed when a bucket is set (takes precedence)', () => {
    expect(createPhotoStore({ s3Bucket: 'b', dataFile: '/tmp/x/h.json' })).toBeInstanceOf(S3PhotoStore);
  });
});
