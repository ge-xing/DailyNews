# Finance RSS Categorization

This folder groups validated finance feeds into six topic categories.

## Category Files

- `categories/macro_policy.txt`: macro, central bank, geopolitics, policy and regulation.
- `categories/markets_assets.txt`: equities, rates, FX, commodities, market structure and signals.
- `categories/companies_industry.txt`: earnings, M&A, company strategy, sector/industry changes.
- `categories/global_general_news.txt`: broad global headlines used as supplementary context.
- `categories/tech_business.txt`: technology/business news with financial impact.
- `categories/crypto_digital_assets.txt`: crypto and digital assets ecosystem.

## Assignment Rules

- Every URL is assigned to exactly one category.
- Priority order for conflict resolution:
  1. `crypto_digital_assets`
  2. `markets_assets`
  3. `macro_policy`
  4. `companies_industry`
  5. `tech_business`
  6. `global_general_news`
- Canonical mapping is stored in `category_index.json`.
