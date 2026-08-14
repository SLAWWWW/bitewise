-- Bitewise seed data — run after schema.sql.

INSERT INTO donors (name, type, lat, lng, address, reliability_score, total_kg_donated, status) VALUES
  ('FairPrice Xtra Toa Payoh', 'supermarket', 1.3340, 103.8470, '480 Lorong 6 Toa Payoh', 0.94, 2340, 'verified'),
  ('Hilton Singapore Orchard', 'hotel', 1.3060, 103.8295, '333 Orchard Road', 0.88, 1850, 'verified'),
  ('Din Tai Fung HQ', 'restaurant', 1.3010, 103.8390, '290 Orchard Road #B1-03', 0.91, 960, 'verified'),
  ('Giant Hypermarket Tampines', 'supermarket', 1.3530, 103.9440, '21 Tampines North Drive 2', 0.96, 3100, 'verified'),
  ('Marina Bay Sands', 'hotel', 1.2834, 103.8607, '10 Bayfront Avenue', 0.85, 4200, 'verified'),
  ('Ya Kun Kaya Toast', 'restaurant', 1.3520, 103.9450, '1 Tampines North Drive 1', 0.79, 420, 'verified'),
  ('Cold Storage Orchard', 'supermarket', 1.3050, 103.8320, '391 Orchard Road', 0.92, 1750, 'verified');

INSERT INTO branches (organization_name, name, area, lat, lng, capacity_kg, current_load_kg, has_cold_storage, has_cooking, color) VALUES
  ('Willing Hearts', 'Willing Hearts — Woodlands', 'North', 1.4382, 103.7891, 500, 120, true, false, '#FF9500'),
  ('Willing Hearts', 'Willing Hearts — Toa Payoh', 'Central', 1.3343, 103.8563, 400, 80, true, true, '#FF3B30'),
  ('Willing Hearts', 'Willing Hearts — Bukit Merah', 'South', 1.2819, 103.8239, 600, 250, true, true, '#AF52DE'),
  ('Willing Hearts', 'Willing Hearts — Yishun', 'North', 1.4304, 103.8354, 350, 45, false, false, '#30D158'),
  ('Willing Hearts', 'Willing Hearts — Tampines', 'East', 1.3496, 103.9568, 450, 180, true, false, '#0A84FF');

INSERT INTO inventory_items (branch_id, item_name, food_type, quantity, unit, storage_type, expiry_at) VALUES
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Woodlands'), 'White Bread (50 loaves)', 'bread', 50, 'loaves', 'ambient', NOW() + INTERVAL '6 hours'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Woodlands'), 'Chicken Rice (30 packs)', 'cooked', 30, 'packs', 'cold', NOW() + INTERVAL '3 hours'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Woodlands'), 'Jasmine Rice (100kg)', 'grain', 100, 'kg', 'ambient', NOW() + INTERVAL '180 days'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Toa Payoh'), 'Fresh Milk (40 cartons)', 'dairy', 40, 'cartons', 'cold', NOW() + INTERVAL '2 hours'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Toa Payoh'), 'Mixed Vegetables (25kg)', 'produce', 25, 'kg', 'cold', NOW() + INTERVAL '4 hours'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Bukit Merah'), 'Canned Tuna (200 cans)', 'canned', 200, 'cans', 'ambient', NOW() + INTERVAL '365 days'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Bukit Merah'), 'Nasi Lemak (45 packs)', 'cooked', 45, 'packs', 'cold', NOW() + INTERVAL '1 hour'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Yishun'), 'Mineral Water (60 bottles)', 'beverage', 60, 'bottles', 'ambient', NOW() + INTERVAL '90 days'),
  ((SELECT id FROM branches WHERE name = 'Willing Hearts — Tampines'), 'Roti Prata (80 pieces)', 'bread', 80, 'pieces', 'cold', NOW() + INTERVAL '2 hours');
