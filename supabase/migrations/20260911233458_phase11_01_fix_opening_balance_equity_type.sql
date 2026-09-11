-- Phase 11: Financial Statements (P&L, Balance Sheet, Cash Flow, Ledgers).
-- Pre-existing classification bug from Phase 0: "1900 Opening Balance Equity"
-- was seeded with account_type='asset' instead of 'equity'. Harmless until
-- now (nothing grouped accounts by type before), but the new Balance Sheet
-- report groups strictly by account_type, so this would silently misclassify
-- every opening-balance entry as an asset instead of equity. Pure label
-- correction — no transactional data, balances, or postings are touched.
update public.chart_of_accounts set account_type = 'equity' where code = '1900';
