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

async function main() {
  const repo = createRepository(serverConfig.dataFile);
  const app = await buildApp({ repo, config: serverConfig });

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

  try {
    await app.listen({ port: serverConfig.port, host: serverConfig.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
