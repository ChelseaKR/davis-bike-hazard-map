import { describe, it, expect } from 'vitest';
import {
  reportSubmissionSchema,
  hazardFiltersSchema,
  moderationDecisionSchema,
} from '../../shared/validation.ts';
import { DAVIS_CENTER } from '../../shared/validation.ts';

const valid = {
  category: 'pothole' as const,
  severity: 'high' as const,
  description: 'Deep pothole',
  location: DAVIS_CENTER,
  photo: null,
  clientId: '11111111-1111-4111-8111-111111111111',
  capturedAt: 1_700_000_000_000,
};

describe('reportSubmissionSchema', () => {
  it('accepts a valid submission', () => {
    expect(reportSubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a location outside Davis', () => {
    const out = reportSubmissionSchema.safeParse({
      ...valid,
      location: { lat: 38.58, lng: -121.49 },
    });
    expect(out.success).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(
      reportSubmissionSchema.safeParse({ ...valid, category: 'aliens' }).success,
    ).toBe(false);
  });

  it('rejects an over-long description', () => {
    expect(
      reportSubmissionSchema.safeParse({ ...valid, description: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });

  it('rejects a non-image photo data URL', () => {
    expect(
      reportSubmissionSchema.safeParse({ ...valid, photo: 'data:text/html;base64,AAAA' })
        .success,
    ).toBe(false);
  });

  it('accepts a valid jpeg data URL', () => {
    expect(
      reportSubmissionSchema.safeParse({ ...valid, photo: 'data:image/jpeg;base64,AAAA' })
        .success,
    ).toBe(true);
  });

  it('rejects a non-uuid clientId', () => {
    expect(reportSubmissionSchema.safeParse({ ...valid, clientId: 'abc' }).success).toBe(
      false,
    );
  });
});

describe('hazardFiltersSchema', () => {
  it('coerces withinDays from a string', () => {
    const out = hazardFiltersSchema.parse({ withinDays: '7' });
    expect(out.withinDays).toBe(7);
  });
  it('rejects an unknown severity', () => {
    expect(hazardFiltersSchema.safeParse({ minSeverity: 'extreme' }).success).toBe(false);
  });
});

describe('moderationDecisionSchema', () => {
  it('accepts approve/reject/resolve', () => {
    for (const decision of ['approve', 'reject', 'resolve'] as const) {
      expect(moderationDecisionSchema.safeParse({ decision }).success).toBe(true);
    }
  });
  it('rejects an unknown decision', () => {
    expect(moderationDecisionSchema.safeParse({ decision: 'nuke' }).success).toBe(false);
  });
});
