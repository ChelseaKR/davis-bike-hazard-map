/**
 * Seed the store with a first pass of (fictional but plausible) Davis hazards,
 * already approved, so the map shows something on first run and e2e/dev have
 * data. Run with: `DATABASE_PATH=./data/hazards.json npm run seed`.
 *
 * These are illustrative seeds, not real reported hazards.
 */
import { serverConfig } from '../server/config.ts';
import { createRepository } from '../server/lib/repository.ts';
import { createPhotoStore } from '../server/lib/photoStore.ts';
import { createHazard, moderateHazard } from '../server/lib/hazards.ts';
import { newId } from '../server/lib/id.ts';
import type { Severity } from '../shared/types.ts';
import type { ValidatedReport } from '../shared/validation.ts';

const ttlOpts = {
  ttlDays: { low: 14, moderate: 21, high: 30 } as Record<Severity, number>,
};

const SEEDS: Omit<ValidatedReport, 'clientId' | 'capturedAt'>[] = [
  {
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole in the bike lane just east of the 5th St light.',
    location: { lat: 38.5462, lng: -121.7361 },
    photo: null,
  },
  {
    category: 'glass_debris',
    severity: 'moderate',
    description: 'Broken glass across the Russell Blvd bike path near Anderson.',
    location: { lat: 38.5431, lng: -121.7649 },
    photo: null,
  },
  {
    category: 'blocked_lane',
    severity: 'high',
    description: 'Delivery truck regularly parked in the bike lane on 3rd St.',
    location: { lat: 38.5436, lng: -121.7402 },
    photo: null,
  },
  {
    category: 'dangerous_intersection',
    severity: 'high',
    description: 'Right-hook risk for cyclists at Covell & F St during commute.',
    location: { lat: 38.5611, lng: -121.7385 },
    photo: null,
  },
  {
    category: 'surface_damage',
    severity: 'low',
    description: 'Rough, cracked pavement along the Davis Bike Loop near campus.',
    location: { lat: 38.5384, lng: -121.7611 },
    photo: null,
  },
  {
    category: 'poor_visibility',
    severity: 'moderate',
    description: 'Overgrown hedge blocking sightlines at a path crossing on Sycamore.',
    location: { lat: 38.5557, lng: -121.7592 },
    photo: null,
  },
];

async function main() {
  const dataFile = serverConfig.dataFile || './data/hazards.json';
  const repo = await createRepository({
    databaseUrl: serverConfig.databaseUrl,
    dataFile: serverConfig.databaseUrl ? undefined : dataFile,
  });
  const photos = createPhotoStore({ dataFile: serverConfig.databaseUrl ? '' : dataFile });
  const now = Date.now();

  let created = 0;
  for (const [i, seed] of SEEDS.entries()) {
    const report: ValidatedReport = {
      ...seed,
      clientId: newId(),
      // Stagger captures over the past few days for realistic recency.
      capturedAt: now - (i + 1) * 12 * 60 * 60 * 1000,
    };
    const stored = await createHazard(repo, photos, report, report.capturedAt, ttlOpts);
    await moderateHazard(repo, photos, stored.id, 'approve', report.capturedAt, undefined, 'seed');
    created++;
  }

  await repo.close?.();
  console.log(`Seeded ${created} approved hazards`);
}

void main();
