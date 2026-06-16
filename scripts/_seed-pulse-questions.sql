-- Re-seed PulseQuestion after the table was silently dropped by a
-- prisma db push --accept-data-loss on 2026-06-12.
--
-- Source: the original three production migrations, replayed:
--   20260608110000_weekly_pulse_questions   (20 weekly questions)
--   20260608120000_pulse_monthly_survey     (6 monthly questions)
--   20260609160000_pulse_strict_brands      (clone into 2 brands)
--
-- Idempotent — uses NOT EXISTS so re-running won't duplicate rows.
-- HR can edit any row from the dashboard after seed.

INSERT INTO "PulseQuestion" ("week", "order", "text", "type", "emojis", "isActive", "surveyType", "brand", "createdAt", "updatedAt")
SELECT * FROM (VALUES
  -- ── NB Media — Weekly ───────────────────────────────────────
  (1, 1, 'How was your week overall?',                                'emoji',  '["😡","😟","😐","🙂","😄"]'::jsonb, true, 'weekly', 'NB Media', NOW(), NOW()),
  (1, 2, 'How would you rate your work-life balance this week?',      'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (1, 3, 'How motivated did you feel to come to work?',               'emoji',  '["😟","😐","🙂","😄","🤩"]'::jsonb, true, 'weekly', 'NB Media', NOW(), NOW()),
  (1, 4, 'How were your energy levels this week?',                    'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (1, 5, 'Anything specific you''d like to share about your week?',   'text',   NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (2, 1, 'How supported did you feel by your manager?',               'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (2, 2, 'How well did your team collaborate this week?',             'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (2, 3, 'Did your manager give you helpful feedback this week?',     'emoji',  '["😞","😐","🙂","😄","🤩"]'::jsonb, true, 'weekly', 'NB Media', NOW(), NOW()),
  (2, 4, 'How was your relationship with your teammates?',            'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (2, 5, 'Any feedback for your manager? (kept anonymous)',           'text',   NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (3, 1, 'How manageable was your workload this week?',               'emoji',  '["😩","😟","😐","🙂","😌"]'::jsonb, true, 'weekly', 'NB Media', NOW(), NOW()),
  (3, 2, 'Did you have the tools and resources you needed?',          'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (3, 3, 'Were your priorities clear this week?',                     'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (3, 4, 'How focused were you able to be?',                          'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (3, 5, 'What''s blocking you right now? (optional)',                'text',   NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (4, 1, 'Did you learn something new this week?',                    'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (4, 2, 'How aligned do you feel with the company''s goals?',        'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (4, 3, 'Would you recommend us as a place to work?',                'emoji',  '["😡","😟","😐","🙂","🤩"]'::jsonb, true, 'weekly', 'NB Media', NOW(), NOW()),
  (4, 4, 'How proud are you of your work this week?',                 'rating', NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),
  (4, 5, 'Anything you''d like leadership to know? (optional)',       'text',   NULL::jsonb,                          true, 'weekly', 'NB Media', NOW(), NOW()),

  -- ── NB Media — Monthly ──────────────────────────────────────
  (NULL, 1, 'How likely are you to recommend NB Media as a place to work?', 'enps',   NULL::jsonb, true, 'monthly', 'NB Media', NOW(), NOW()),
  (NULL, 2, 'My manager genuinely supports my growth and wellbeing.',       'likert', NULL::jsonb, true, 'monthly', 'NB Media', NOW(), NOW()),
  (NULL, 3, 'I see a clear path for my career at this company.',            'likert', NULL::jsonb, true, 'monthly', 'NB Media', NOW(), NOW()),
  (NULL, 4, 'My work is recognised when I do something well.',              'likert', NULL::jsonb, true, 'monthly', 'NB Media', NOW(), NOW()),
  (NULL, 5, 'I can maintain a healthy work-life balance.',                  'likert', NULL::jsonb, true, 'monthly', 'NB Media', NOW(), NOW()),
  (NULL, 6, 'What''s one thing we should start, stop, or keep doing?',      'text',   NULL::jsonb, true, 'monthly', 'NB Media', NOW(), NOW()),

  -- ── YT Labs — Weekly ────────────────────────────────────────
  (1, 1, 'How was your week overall?',                                'emoji',  '["😡","😟","😐","🙂","😄"]'::jsonb, true, 'weekly', 'YT Labs', NOW(), NOW()),
  (1, 2, 'How would you rate your work-life balance this week?',      'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (1, 3, 'How motivated did you feel to come to work?',               'emoji',  '["😟","😐","🙂","😄","🤩"]'::jsonb, true, 'weekly', 'YT Labs', NOW(), NOW()),
  (1, 4, 'How were your energy levels this week?',                    'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (1, 5, 'Anything specific you''d like to share about your week?',   'text',   NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (2, 1, 'How supported did you feel by your manager?',               'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (2, 2, 'How well did your team collaborate this week?',             'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (2, 3, 'Did your manager give you helpful feedback this week?',     'emoji',  '["😞","😐","🙂","😄","🤩"]'::jsonb, true, 'weekly', 'YT Labs', NOW(), NOW()),
  (2, 4, 'How was your relationship with your teammates?',            'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (2, 5, 'Any feedback for your manager? (kept anonymous)',           'text',   NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (3, 1, 'How manageable was your workload this week?',               'emoji',  '["😩","😟","😐","🙂","😌"]'::jsonb, true, 'weekly', 'YT Labs', NOW(), NOW()),
  (3, 2, 'Did you have the tools and resources you needed?',          'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (3, 3, 'Were your priorities clear this week?',                     'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (3, 4, 'How focused were you able to be?',                          'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (3, 5, 'What''s blocking you right now? (optional)',                'text',   NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (4, 1, 'Did you learn something new this week?',                    'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (4, 2, 'How aligned do you feel with the company''s goals?',        'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (4, 3, 'Would you recommend us as a place to work?',                'emoji',  '["😡","😟","😐","🙂","🤩"]'::jsonb, true, 'weekly', 'YT Labs', NOW(), NOW()),
  (4, 4, 'How proud are you of your work this week?',                 'rating', NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),
  (4, 5, 'Anything you''d like leadership to know? (optional)',       'text',   NULL::jsonb,                          true, 'weekly', 'YT Labs', NOW(), NOW()),

  -- ── YT Labs — Monthly ───────────────────────────────────────
  (NULL, 1, 'How likely are you to recommend YT Labs as a place to work?',  'enps',   NULL::jsonb, true, 'monthly', 'YT Labs', NOW(), NOW()),
  (NULL, 2, 'My manager genuinely supports my growth and wellbeing.',       'likert', NULL::jsonb, true, 'monthly', 'YT Labs', NOW(), NOW()),
  (NULL, 3, 'I see a clear path for my career at this company.',            'likert', NULL::jsonb, true, 'monthly', 'YT Labs', NOW(), NOW()),
  (NULL, 4, 'My work is recognised when I do something well.',              'likert', NULL::jsonb, true, 'monthly', 'YT Labs', NOW(), NOW()),
  (NULL, 5, 'I can maintain a healthy work-life balance.',                  'likert', NULL::jsonb, true, 'monthly', 'YT Labs', NOW(), NOW()),
  (NULL, 6, 'What''s one thing we should start, stop, or keep doing?',      'text',   NULL::jsonb, true, 'monthly', 'YT Labs', NOW(), NOW())
) AS seed (week, "order", text, type, emojis, "isActive", "surveyType", brand, "createdAt", "updatedAt")
WHERE NOT EXISTS (
  SELECT 1 FROM "PulseQuestion" p
   WHERE p."surveyType" = seed."surveyType"
     AND p.brand        = seed.brand
     AND p."order"      = seed."order"
     AND ((p.week IS NULL AND seed.week IS NULL) OR p.week = seed.week)
);
