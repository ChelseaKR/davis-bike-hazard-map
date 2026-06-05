/**
 * Production/dev entry point: build the app with the real repository and start
 * listening. In production it also serves the built PWA from ./dist so the
 * whole thing runs as a single process.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.ts';
import { serverConfig } from './config.ts';
import { createRepository } from './lib/repository.ts';
import { createPhotoStore } from './lib/photoStore.ts';
import { migrateInlinePhotos } from './lib/hazards.ts';
import { startBackups } from './lib/backup.ts';

async function main() {
  // Production must use a real database. The one exception is ephemeral
  // throwaway runs (e2e, preview) that opt in explicitly with ALLOW_INMEMORY.
  if (serverConfig.isProd && !serverConfig.databaseUrl && process.env.ALLOW_INMEMORY !== 'true') {
    console.error('DATABASE_URL is required in production. Refusing to start.');
    process.exit(1);
  }

  const repo = await createRepository({
    databaseUrl: serverConfig.databaseUrl,
    dataFile: serverConfig.dataFile,
  });
  const photos = createPhotoStore(serverConfig.dataFile);
  // Move any legacy inline (base64) photos out of the JSON into the blob store.
  const migrated = await migrateInlinePhotos(repo, photos);
  const app = await buildApp({ repo, photos, config: serverConfig });
  if (migrated > 0) {
    app.log.info(`Migrated ${migrated} inline photo(s) to the blob store.`);
  }

  // Serve the built client (and SPA fallback) in production.
  if (serverConfig.serveClient) {
    const root = resolve(process.cwd(), serverConfig.clientDir);
    if (existsSync(root)) {
      await app.register(fastifyStatic, { root, wildcard: false });
      app.setNotFoundHandler((req, reply) => {
        // API 404s stay JSON; everything else falls back to the SPA shell.
        if (req.url.startsWith('/api/')) {
          return reply.status(404).send({ error: 'not_found', message: 'Not found.' });
        }
        return reply.sendFile('index.html');
      });
    } else {
      app.log.warn(`CLIENT_DIR "${root}" not found — run "npm run build" first.`);
    }
  }

  if (serverConfig.isProd && !serverConfig.moderationToken) {
    app.log.error('MODERATION_TOKEN is required in production. Refusing to start.');
    process.exit(1);
  }
  if (!serverConfig.isProd) {
    app.log.info(`Dev moderator token: ${serverConfig.moderationToken}`);
  }

  // Periodic expiry sweep so the map self-cleans even with no traffic.
  const sweep = setInterval(
    () => {
      // listPublic sweeps as a side effect; calling the route logic directly
      // would be cleaner, but a lightweight import keeps this file small.
      void import('./lib/hazards.ts').then(({ sweepExpired }) =>
        sweepExpired(repo, Date.now()),
      );
    },
    60 * 60 * 1000,
  );
  sweep.unref?.();

  // Periodic timestamped snapshots of the JSON store (no-op in-memory).
  startBackups(
    {
      dataFile: serverConfig.dataFile,
      backupDir: serverConfig.backup.dir,
      retain: serverConfig.backup.retain,
    },
    serverConfig.backup.intervalHours * 60 * 60 * 1000,
    (path) => app.log.info(`Data snapshot written: ${path}`),
  );

  try {
    await app.listen({ port: serverConfig.port, host: serverConfig.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
