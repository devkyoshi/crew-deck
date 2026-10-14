UPDATE plans SET limits = limits - 'work_items' - 'max_attachment_mb',
  features = array_remove(array_remove(array_remove(features, 'scrum_sprints'), 'shared_filters'), 'burndown_reports');
