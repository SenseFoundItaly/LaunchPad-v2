import { describe, it, expect } from 'vitest';
import { buildSpinePreview } from './validation-targets';
import { STAGES } from './index';

// The upload draft's per-stage spine preview (stage → checks filled → the
// statement filling each). These pin the grouping semantics: primary-target
// only, stage-definition ordering, non-gated items dropped.

describe('buildSpinePreview', () => {
  it('groups canvas fields under their Stage-1 checks, keeping the statement', () => {
    const preview = buildSpinePreview([
      { kind: 'canvas_field', field: 'solution', statement: 'Spec Studio digitizes material knowledge.', target: 'canvas_field', target_field: 'solution' },
      { kind: 'canvas_field', field: 'problem', statement: 'The style office compiles ~100 sheets by hand.', target: 'canvas_field', target_field: 'problem' },
    ]);
    expect(preview).toHaveLength(1);
    const stage1 = preview[0];
    expect(stage1.stage_number).toBe(1);
    expect(stage1.stage_id).toBe('idea_validation');
    // Checks render in stage-definition order (problem before solution), not
    // extraction order.
    expect(stage1.checks.map((c) => c.check_id)).toEqual(['problem_defined', 'solution_sketched']);
    expect(stage1.checks[0].statements[0]).toMatchObject({
      kind: 'canvas_field',
      field: 'problem',
      statement: 'The style office compiles ~100 sheets by hand.',
    });
  });

  it('merges multiple competitor entities under the one competitors_mapped check', () => {
    const preview = buildSpinePreview([
      { kind: 'entity', name: 'Acme', statement: 'Acme — incumbent PLM.', target: 'competitor' },
      { kind: 'entity', name: 'Globex', statement: 'Globex — spreadsheet add-in.', target: 'competitor' },
    ]);
    expect(preview).toHaveLength(1);
    expect(preview[0].stage_number).toBe(2);
    expect(preview[0].checks).toHaveLength(1);
    expect(preview[0].checks[0].check_id).toBe('competitors_mapped');
    expect(preview[0].checks[0].statements.map((s) => s.name)).toEqual(['Acme', 'Globex']);
  });

  it('orders stages ascending and reports the real per-stage check totals', () => {
    const preview = buildSpinePreview([
      { kind: 'entity', name: 'Acme', statement: 'Acme.', target: 'competitor' },
      { kind: 'canvas_field', field: 'problem', statement: 'p', target: 'canvas_field', target_field: 'problem' },
    ]);
    expect(preview.map((s) => s.stage_number)).toEqual([1, 2]);
    for (const stage of preview) {
      const defined = STAGES.find((s) => s.number === stage.stage_number)!;
      expect(stage.total_checks).toBe(defined.checks.length);
      expect(stage.checks.length).toBeLessThanOrEqual(stage.total_checks);
    }
  });

  it('drops items with no gated target (context, never a phantom step)', () => {
    // business_model is deliberately context-only (see CanvasFieldName note).
    const preview = buildSpinePreview([
      { kind: 'canvas_field', field: 'business_model', statement: 'Fixed-price setup.', target: 'canvas_field', target_field: 'business_model' },
    ]);
    expect(preview).toEqual([]);
  });
});
