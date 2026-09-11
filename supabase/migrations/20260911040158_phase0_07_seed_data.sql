-- Numbering sequences (§4.1 of the blueprint)
insert into public.numbering_sequences (doc_type, label, prefix, fy_reset, padding) values
  ('QRY', 'Query',                'QRY-', true, 4),
  ('QTN', 'Quotation',            'QTN-', true, 4),
  ('SO',  'Sales Order',          'SO-',  true, 4),
  ('PO',  'Purchase Order',       'PO-',  true, 4),
  ('GRN', 'Goods Receipt Note',   'GRN-', true, 4),
  ('JOB', 'Job / Work Order',     'JOB-', true, 4),
  ('DC',  'Delivery Challan',     'DC-',  true, 4),
  ('INV', 'GST Invoice',          'INV-', true, 4),
  ('PAY', 'Payment',              'PAY-', true, 4),
  ('JV',  'Journal Voucher',      'JV-',  true, 4);

-- Units
insert into public.units (code, name) values
  ('KG','Kilogram'), ('TON','Ton'), ('PCS','Pieces'), ('FT','Feet'),
  ('M','Meter'), ('NOS','Numbers'), ('SET','Set'), ('LTR','Litre'), ('SQFT','Square Feet');

insert into public.unit_conversions (from_unit, to_unit, factor) values
  ('TON','KG', 1000), ('KG','TON', 0.001),
  ('M','FT', 3.28084), ('FT','M', 0.3048);

-- Default warehouse
insert into public.warehouses (code, name) values ('MAIN', 'Main Warehouse');

-- Chart of Accounts — starter set (§6.1 of the blueprint)
insert into public.chart_of_accounts (code, name, account_type, is_system) values
  ('1100', 'Bank / Cash',                                   'asset',     true),
  ('1200', 'Trade Receivables (AR)',                        'asset',     true),
  ('1310', 'Raw Material Inventory',                        'asset',     true),
  ('1320', 'Work-in-Progress (Jobs)',                       'asset',     true),
  ('1330', 'GRN Clearing',                                  'asset',     true),
  ('1400', 'Input Sales Tax (GST) — reclaimable',           'asset',     true),
  ('1900', 'Opening Balance Equity',                        'asset',     true),
  ('2100', 'Trade Payables (AP)',                           'liability', true),
  ('2400', 'Output Sales Tax (GST) Payable to FBR',         'liability', true),
  ('3000', 'Owner''s Equity',                                'equity',    true),
  ('4000', 'Sales Revenue — Material Supply',               'income',    true),
  ('4010', 'Sales Revenue — Fabrication',                   'income',    true),
  ('5000', 'Cost of Goods Sold — Material Supply',          'expense',   true),
  ('5010', 'Cost of Goods Sold — Fabrication',              'expense',   true),
  ('5900', 'Inventory Adjustment',                          'expense',   true);
