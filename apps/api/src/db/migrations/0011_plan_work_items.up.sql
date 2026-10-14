-- Work management plan gates (docs/work-items/PRICING-GATES.md).
-- Limits: work_items (Free only; Team and Business are unlimited), max_attachment_mb.
-- Features: scrum_sprints, shared_filters (Team and up), burndown_reports (Business and up).
UPDATE plans SET limits = limits || '{"work_items":250,"max_attachment_mb":5}'::jsonb WHERE key = 'free';
UPDATE plans SET limits = limits || '{"max_attachment_mb":25}'::jsonb,
  features = features || '{scrum_sprints,shared_filters}'::text[] WHERE key = 'team';
UPDATE plans SET limits = limits || '{"max_attachment_mb":100}'::jsonb,
  features = features || '{scrum_sprints,shared_filters,burndown_reports}'::text[] WHERE key = 'business';
UPDATE plans SET features = features || '{scrum_sprints,shared_filters,burndown_reports}'::text[] WHERE key = 'enterprise';
