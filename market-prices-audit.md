# Market Prices Audit

## 1. Generation

- Generated: 2026-09-27T11:00:31.380800+00:00
- Product pages analyzed: 6694
- Pages without identifiable Shopify Product ID: 15
- Matrix Product IDs: 235
- Matrix Variant IDs: 542
- Catalog Product IDs: 134
- Catalog Variant IDs: 319

## 2. Markets

| Market | Currency | Products |
|---|---|---:|
| US | USD | 234 |
| AT | EUR | 133 |
| DE | EUR | 132 |
| ES | EUR | 131 |
| FR | EUR | 131 |
| IT | EUR | 131 |
| LU | EUR | 131 |
| NL | EUR | 132 |
| PL | PLN | 131 |

## 3. Variant coverage

- Variants present in all 9 markets: 314
- Variants present in 8 markets: 2
- Variants present in 7 markets: 0
- Variants present in 6 markets: 0
- Variants present in 5 markets: 1
- Variants present in 4 markets: 0
- Variants present in 3 markets: 0
- Variants present in 2 markets: 0
- Variants present in 1 market: 225
- Products present in all 9 markets: 130

## 4. Currency validation

- Currency anomalies: 0
- No unexpected market currency detected.

## 5. Catalog comparison

- Common Product IDs: 134
- Common Variant IDs: 319
- Catalog variants absent from matrix: 0
- Matrix variants absent from catalog: 223
- US price mismatches against catalog: 0

## 6. BP10 reference

### Variant `46247317471487`
- US: `{'price': 69.99, 'currency': 'USD'}`
- AT: `{'price': 70.95, 'currency': 'EUR'}`
- DE: `{'price': 68.95, 'currency': 'EUR'}`
- ES: `{'price': 66.95, 'currency': 'EUR'}`
- FR: `{'price': 70.95, 'currency': 'EUR'}`
- IT: `{'price': 66.95, 'currency': 'EUR'}`
- LU: `{'price': 70.95, 'currency': 'EUR'}`
- NL: `{'price': 69.99, 'currency': 'EUR'}`
- PL: `{'price': 273.0, 'currency': 'PLN'}`
### Variant `46247317504255`
- US: `{'price': 89.99, 'currency': 'USD'}`
- AT: `{'price': 90.95, 'currency': 'EUR'}`
- DE: `{'price': 88.95, 'currency': 'EUR'}`
- ES: `{'price': 85.95, 'currency': 'EUR'}`
- FR: `{'price': 90.95, 'currency': 'EUR'}`
- IT: `{'price': 85.95, 'currency': 'EUR'}`
- LU: `{'price': 90.95, 'currency': 'EUR'}`
- NL: `{'price': 89.99, 'currency': 'EUR'}`
- PL: `{'price': 351.0, 'currency': 'PLN'}`
### Variant `46295465394431`
- US: `{'price': 80.99, 'currency': 'USD'}`
- AT: `{'price': 81.95, 'currency': 'EUR'}`
- DE: `{'price': 79.95, 'currency': 'EUR'}`
- ES: `{'price': 76.95, 'currency': 'EUR'}`
- FR: `{'price': 81.95, 'currency': 'EUR'}`
- IT: `{'price': 76.95, 'currency': 'EUR'}`
- LU: `{'price': 81.95, 'currency': 'EUR'}`
- NL: `{'price': 80.99, 'currency': 'EUR'}`
- PL: `{'price': 316.0, 'currency': 'PLN'}`

## 7. BP20 reference

- Candidate Product ID: `8917822603519`
- Expected known values: US 179.99 USD; AT 180.95 EUR; DE 176.95 EUR; ES 171.95 EUR; FR 180.95 EUR; IT 171.95 EUR; LU 180.95 EUR; NL 179.99 EUR; PL 702.00 PLN.

## 8. Matrix rules

- Primary key: Shopify Product ID + Shopify Variant ID.
- SKU is never used as the primary join key.
- No currency conversion is performed.
- No market value is back-filled from another market.
- Missing market variants are stored as `null`.
- Prices come from the local market product HTML.

## 9. Output

- JSON: `/workspaces/ibuture/market-prices.json`
- JSON size: 311156 bytes
- JSON SHA-256: `e746614bfa856c0b0f4f3b9247850c0440c8bcd1e15020f1db259c1f6cc659f8`
- Audit: `/workspaces/ibuture/market-prices-audit.md`

