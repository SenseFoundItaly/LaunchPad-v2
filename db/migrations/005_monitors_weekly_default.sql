-- Reset ecosystem monitors from hourly to their intended template schedules.
-- Templates: competitors/ip/trends/partnerships/ads = weekly; hiring/sentiment/social = monthly; health = weekly.
UPDATE monitors SET schedule = 'weekly'
  WHERE schedule = 'hourly'
  AND type IN ('ecosystem.competitors', 'ecosystem.ip', 'ecosystem.trends',
               'ecosystem.partnerships', 'ecosystem.ads', 'health');

UPDATE monitors SET schedule = 'monthly'
  WHERE schedule = 'hourly'
  AND type IN ('ecosystem.hiring', 'ecosystem.customer_sentiment', 'ecosystem.social');
