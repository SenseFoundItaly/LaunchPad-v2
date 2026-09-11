import { describe, it, expect } from 'vitest';
import ArtifactRenderer from '@/components/chat/artifacts/ArtifactRenderer';

// A3: ArtifactRenderer has no hooks before its switch, so we can call it as a
// plain function and assert its RETURN (creating a React element ≠ rendering it,
// so no child hooks fire). This pins the loud-failure fallback + guards the two
// INTENTIONAL nulls (task/fact) against an accidental regression.
const noop = () => {};
const render = (type: string) =>
  ArtifactRenderer({
    artifact: { type } as never,
    onAction: noop,
    onEntityDiscovered: noop,
  });

describe('ArtifactRenderer A3 fallback', () => {
  it('renders a visible card for an UNKNOWN artifact type (no silent null)', () => {
    expect(render('totally-unknown-type-xyz')).not.toBeNull();
  });

  it('keeps task and fact as null (intentional — inline/server-only, NOT a failure)', () => {
    expect(render('task')).toBeNull();
    expect(render('fact')).toBeNull();
  });

  it('still renders a known type', () => {
    expect(render('option-set')).not.toBeNull();
  });
});
