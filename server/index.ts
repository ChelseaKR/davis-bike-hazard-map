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
import { createModeratorStore, bootstrapModerator } from './lib/moderators.ts';
import { startBackups } from './lib/backup.ts';
import { initSentry } from './lib/sentry.ts';
import { logBootFatal } from './lib/logger.ts';

async function main() {
  // Server-side error reporting (no-op without SENTRY_DSN). Traces sampled at
  // the env-configured rate (non-zero by default) so performance data flows.
  initSentry(
    serverConfig.sentryDsn,
    serverConfig.isProd ? 'production' : 'development',
    serverConfig.sentryTracesSampleRate,
  );

  // Production must use a real database. The one exception is ephemeral
  // throwaway runs (e2e, preview) that opt in explicitly with ALLOW_INMEMORY.
  if (serverConfig.isProd && !serverConfig.databaseUrl && process.env.ALLOW_INMEMORY !== 'true') {
    logBootFatal('DATABASE_URL is required in production. Refusing to start.');
    process.exit(1);
  }
  if (serverConfig.isProd && !serverConfig.sessionSecret) {
    logBootFatal('SESSION_SECRET is required in production. Refusing to start.');
    process.exit(1);
  }

  const repo = await createRepository({
    databaseUrl: serverConfig.databaseUrl,
    dataFile: serverConfig.dataFile,
  });
  const photos = createPhotoStore({
    s3Bucket: serverConfig.s3.bucket,
    s3Prefix: serverConfig.s3.prefix,
    s3Endpoint: serverConfig.s3.endpoint,
    s3Region: serverConfig.s3.region,
    dataFile: serverConfig.dataFile,
  });
  const moderators = await createModeratorStore(serverConfig.databaseUrl);
  // Move any legacy inline (base64) photos out of the JSON into the blob store.
  const migrated = await migrateInlinePhotos(repo, photos);
  const app = await buildApp({ repo, photos, moderators, config: serverConfig });
  if (migrated > 0) {
    app.log.info(`Migrated ${migrated} inline photo(s) to the blob store.`);
  }

  // Seed the bootstrap moderator on first boot (idempotent).
  const created = await bootstrapModerator(
    moderators,
    serverConfig.moderatorBootstrap.username,
    serverConfig.moderatorBootstrap.password,
    Date.now(),
  );
  if (created) app.log.info(`Bootstrapped moderator account: ${created}`);
  if (!serverConfig.isProd) {
    app.log.info('Dev moderator login — username: admin, password: admin');
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

  // Close the DB pool when the app closes (covers shutdown + tests).
  app.addHook('onClose', async () => {
    await repo.close?.();
  });

  // Graceful shutdown: stop accepting connections, drain in-flight requests,
  // then close the DB pool — so a Fly/Docker rolling deploy doesn't drop work.
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info(`${signal} received — shutting down gracefully…`);
      const force = setTimeout(() => {
        app.log.error('Shutdown timed out; forcing exit.');
        process.exit(1);
      }, 10_000);
      force.unref();
      app
        .close()
        .then(() => process.exit(0))
        .catch((err) => {
          app.log.error(err);
          process.exit(1);
        });
    });
  }

  try {
    await app.listen({ port: serverConfig.port, host: serverConfig.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
