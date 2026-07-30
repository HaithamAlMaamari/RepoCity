import { describe, expect, it } from 'vitest';
import { repositoryView } from './camera';

describe('repositoryView', () => {
  it('uses a close framing floor for small repositories', () => {
    const view = repositoryView(20, 48);
    expect(view.targetY).toBeCloseTo(43.2);
    expect(view.targetDist).toBe(84);
    expect(view.targetFocusY).toBeCloseTo(27.84);
  });

  it('scales independently with footprint and skyline height', () => {
    expect(repositoryView(200, 72).targetDist).toBe(310);
    const tallView = repositoryView(80, 100);
    expect(tallView.targetY).toBe(90);
    expect(tallView.targetDist).toBe(175);
    expect(tallView.targetFocusY).toBeCloseTo(58);
    expect(repositoryView(200, 72, 390 / 844).targetDist).toBeCloseTo(692.51, 2);
  });
});
