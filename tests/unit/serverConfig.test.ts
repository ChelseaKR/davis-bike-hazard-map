import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigins = process.env.CORS_ORIGINS;

describe('server CORS configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
  });

  afterEach(() => {
    vi.resetModules();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalCorsOrigins;
  });

  it('defaults to same-origin only in production', async () => {
    const { serverConfig } = await import('../../server/config.ts');
    expect(serverConfig.corsOrigins).toEqual([]);
  });

  it('retains explicitly configured production origins', async () => {
    process.env.CORS_ORIGINS = 'https://map.example.gov, https://admin.example.gov';
    const { serverConfig } = await import('../../server/config.ts');
    expect(serverConfig.corsOrigins).toEqual([
      'https://map.example.gov',
      'https://admin.example.gov',
    ]);
  });
});
