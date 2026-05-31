import { describe, it, expect } from 'vitest';
import { hazardIcon, SEVERITY_COLORS } from '../../src/components/mapIcons.ts';

describe('hazardIcon', () => {
  it('builds an inline SVG data-URL icon per severity (no binary assets)', () => {
    const icon = hazardIcon('high');
    const url = icon.options.iconUrl as string;
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(icon.options.iconSize).toEqual([28, 40]);
  });

  it('caches icons by severity (same instance returned)', () => {
    expect(hazardIcon('low')).toBe(hazardIcon('low'));
  });

  it('uses a distinct colour per severity', () => {
    const colors = new Set(Object.values(SEVERITY_COLORS));
    expect(colors.size).toBe(3);
  });
});
