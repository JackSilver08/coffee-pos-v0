# Coffee POS v1 release notes

## RBAC
Three primary roles are implemented:

- cashier
- barista
- admin

Authorization is enforced server-side in Express and mirrored in the Electron UI.

## Cashier
- POS sales
- cash / demo QR payment
- open and close own shift
- view today's orders

## Barista
- KDS only
- NEW → PREPARING → READY → DONE
- cannot create orders or payments

## Admin
- all v1 capabilities
- product/category management
- reports
- user creation and enable/disable
- KDS and sales operations

## Security
- password hashing with scrypt
- session tokens stored as SHA-256 hashes
- role middleware on protected APIs
- audit records for login/logout, shifts, orders, products, user changes and KDS status changes

## Next
Inventory + Recipe, Variant/Topping/Combo, refunds/voids, e-invoice integration, payment webhooks, then LAN multi-terminal sync.
