# SATOSHIFLOW PROTOTYPE — AUTONOMOUS ENGINEERING BUILD REPORT

## 1. Environment Verification
- **OS**: Linux Fedora
- **Runtime**: Node.js v22.23.1, pnpm v10.32.1
- **Database**: Native PostgreSQL 18.6 (`postgresql://satoshiflow:satoshiflow@localhost:5432/satoshiflow`)
- **Containers & Blockchain**:
  - Podman runtime
  - Bitcoin Core Regtest (`polar-n2-backend1`): RPC Port `18447`, active block height `229+`
  - LND Alice (`polar-n2-alice`): REST Port `8082`, gRPC Port `10002`, 2 active channels, peer route to Bob (`10.89.3.28:9735`)
  - CLN Bob (`polar-n2-bob`): REST Port `8182`

## 2. Implemented Architecture & Subsystems
- **Customer-Pays-Fee Engine (50 bps / 0.5%)**:
  `customer_total = merchant_price / (1 - 0.005)`.
  Tested: $100.00 Merchant Price produces exact $100.50 Customer Total (166,666 sats merchant + 834 sats platform fee = 167,500 sats total).
- **Double-Entry Financial Accounting Ledger**:
  Database table `LedgerAccount` and `LedgerEntry` record balanced journal entries on payment creation:
  - Debit: `Settlement_Receivable` (Asset, 167,500 sats)
  - Credit: `Merchant_Balance` (Liability, 166,666 sats)
  - Credit: `Platform_Fee_Revenue` (Revenue, 834 sats)
- **Database Schema**:
  19 relational models migrated on native PostgreSQL 18.6 (`Organization`, `User`, `Store`, `ApiKey`, `Product`, `Order`, `Payment`, `Quote`, `PaymentAttempt`, `Wallet`, `WalletAddress`, `FeePolicy`, `FeeObligation`, `LedgerAccount`, `LedgerEntry`, `WebhookEndpoint`, `WebhookEvent`, `WebhookDelivery`, `AuditLog`).
- **Idempotency Guarantee**:
  `Idempotency-Key` HTTP header support prevents duplicate charge creation; re-submitting identical keys returns existing payment entities immediately.
- **HMAC SHA-256 Webhooks**:
  `POST /v1/webhooks/sign` produces verified `t=<timestamp>,v1=<signature>` HMAC tokens with replay prevention.
- **Hosted Checkout**:
  Interactive standalone interface in `apps/checkout/dist/index.html` featuring instant QR rendering, tabbed Bitcoin On-Chain / Lightning Switch, and real-time Server-Sent Events (`/v1/payments/:id/events`).

## 3. End-to-End Verification Evidence
- Live payment created via `POST /v1/payments`:
  - Payment ID: `pay_02fe6077d9046c77`
  - Bitcoin Regtest Destination: `bcrt1qkdx4wq78ts8x6lycfxz2sjumd4pyp7vcuzh9tt`
  - Lightning LND Regtest Invoice: `lnbcrt1675u1p4tv3eqpp5xxa9w5585hlsql4e7q9kwsgdprn6258vet3tha8kzfl9xsmryx9sdqhfaexgetjypjrgenr893nxegcqzzsxqyz5vqsp5tzl8y5wxrsyc8uepjpn6ecj5mypu6tdktdefjw92ag4mpqmzh7ss9qxpqysgqrl28axs53ufkfaxf8dgczvmnm3rhdn6h2gah9k67c4u7dq5a73m34dzkq5xpnvs7zsyhm37g25mepr8zge4caw7acaqeyqr9ruxaqdgqwqa7h8`
  - Preimage Hash: `31ba575287a5ff007eb9f00b67410d08e7a550eccae2bbf4f6127e534363218b`
- PostgreSQL Ledger Records confirmed:
  - Row 1: `166,666 sats` ('Customer payment merchant share')
  - Row 2: `834 sats` ('SatoshiFlow 0.5% platform fee')
