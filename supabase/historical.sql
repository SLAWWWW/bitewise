-- Run right before a demo to pre-populate the dashboard with delivered history
-- so the stat cards and fairness gauge aren't sitting at zero.

INSERT INTO food_listings (donor_id, matched_branch_id, item_name, food_type, quantity_kg, storage_type, expiry_at, status, matched_at, delivered_at)
SELECT
  (SELECT id FROM donors ORDER BY random() LIMIT 1),
  (SELECT id FROM branches ORDER BY random() LIMIT 1),
  (ARRAY['Nasi Lemak','Bread Loaves','Fresh Vegetables','Canned Tuna','Chicken Rice','Mineral Water','Roti Prata','Mixed Fruits'])[floor(random()*8+1)],
  (ARRAY['cooked','bread','produce','canned','cooked','beverage','bread','produce'])[floor(random()*8+1)],
  floor(random()*80+20),
  (ARRAY['ambient','cold','cold','ambient','cold','ambient','cold','cold'])[floor(random()*8+1)],
  NOW() + INTERVAL '24 hours',
  'delivered',
  NOW() - (random() * INTERVAL '7 days'),
  NOW() - (random() * INTERVAL '3 days')
FROM generate_series(1, 15);
