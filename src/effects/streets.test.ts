import { describe, expect, it } from 'vitest';
import type { PlotRect, StreetSegment } from '../types';
import { clipStreetsToPlots } from './streets';

describe('street plot clearance', () => {
  it('splits roads around occupied file plots on both axes', () => {
    const streets: StreetSegment[] = [
      { x1: 0, z1: 5, x2: 20, z2: 5, width: 2, axis: 'x' },
      { x1: 5, z1: 0, x2: 5, z2: 20, width: 2, axis: 'z' },
    ];
    const plots: PlotRect[] = [
      { x: 4, z: 4, w: 4, d: 4 },
      { x: 12, z: 4, w: 2, d: 4 },
    ];

    expect(clipStreetsToPlots(streets, plots)).toEqual([
      { ...streets[0], x1: 0, x2: 4 },
      { ...streets[0], x1: 8, x2: 12 },
      { ...streets[0], x1: 14, x2: 20 },
      { ...streets[1], z1: 0, z2: 4 },
      { ...streets[1], z1: 8, z2: 20 },
    ]);
  });
});
