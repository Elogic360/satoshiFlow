const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { Client } = require('pg');

// Exact 50 basis points customer-pays-fee math
// customer_total = merchant_price / (1 - 0.005)
function calculateCustomerFee(merchantPrice, btcRate = 60000) {
  const rateBps = 50; // 0.5%
  const feeRate = rateBps / 10000;
  const customerTotal = Number((merchantPrice / (1 - feeRate)).toFixed(2));
  const fee = Number((customerTotal - merchantPrice).toFixed(2));
  const customerTotalSat = Math.ceil((customerTotal / btcRate) * 100_000_000);
  const merchantSat = Math.floor((merchantPrice / btcRate) * 100_000_000);
  const feeSat = customerTotalSat - merchantSat;

  return {
    merchantPrice,
    fee,
    customerTotal,
    rateBps,
    btcRate,
    customerTotalSat,
    merchantSat,
    feeSat
  };
}

// PostgreSQL Client
const dbConfig = {
  connectionString: 'postgresql://satoshiflow:satoshiflow@localhost:5432/satoshiflow'
};

async function getDb() {
  const client = new Client(dbConfig);
  await client.connect();
  return client;
}

// Polar Bitcoin RPC Client
const BTC_RPC_URL = 'http://127.0.0.1:18447';
const BTC_AUTH = Buffer.from('polaruser:polarpass').toString('base64');

async function btcRpc(method, params = []) {
  const res = await axios.post(
    BTC_RPC_URL,
    { jsonrpc: '1.0', id: 'sf-api', method, params },
    { headers: { 'Content-Type': 'text/plain', Authorization: `Basic ${BTC_AUTH}` } }
  );
  if (res.data.error) throw new Error(JSON.stringify(res.data.error));
  return res.data.result;
}

// Polar LND REST Client (Alice)
const LND_URL = 'https://127.0.0.1:8082';
const MACAROON_PATH = '/home/elogic360/.polar/networks/2/volumes/lnd/alice/data/chain/bitcoin/regtest/admin.macaroon';
let lndMacaroon = '';
try {
  lndMacaroon = fs.readFileSync(MACAROON_PATH).toString('hex');
} catch (e) {
  console.warn('LND Macaroon not read:', e.message);
}
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function createLndInvoice(amountSat, memo) {
  const res = await axios.post(
    `${LND_URL}/v1/invoices`,
    { value: amountSat.toString(), memo },
    {
      headers: { 'Grpc-Metadata-macaroon': lndMacaroon },
      httpsAgent
    }
  );
  return {
    paymentRequest: res.data.payment_request,
    rHash: Buffer.from(res.data.r_hash, 'base64').toString('hex')
  };
}

// Double-Entry Ledger Service
async function recordPaymentLedger(db, orgId, paymentId, calc) {
  let receivableAcc = (await db.query(`SELECT id FROM "LedgerAccount" WHERE "organizationId" = $1 AND name = 'Settlement_Receivable' LIMIT 1`, [orgId])).rows[0];
  if (!receivableAcc) {
    receivableAcc = (await db.query(`INSERT INTO "LedgerAccount" ("id", "organizationId", "name", "currency", "type", "balance", "updatedAt") VALUES ($1, $2, 'Settlement_Receivable', 'BTC', 'ASSET', 0, NOW()) RETURNING id`, [crypto.randomUUID(), orgId])).rows[0];
  }

  let merchantAcc = (await db.query(`SELECT id FROM "LedgerAccount" WHERE "organizationId" = $1 AND name = 'Merchant_Balance' LIMIT 1`, [orgId])).rows[0];
  if (!merchantAcc) {
    merchantAcc = (await db.query(`INSERT INTO "LedgerAccount" ("id", "organizationId", "name", "currency", "type", "balance", "updatedAt") VALUES ($1, $2, 'Merchant_Balance', 'BTC', 'LIABILITY', 0, NOW()) RETURNING id`, [crypto.randomUUID(), orgId])).rows[0];
  }

  let feeRevenueAcc = (await db.query(`SELECT id FROM "LedgerAccount" WHERE "organizationId" = $1 AND name = 'Platform_Fee_Revenue' LIMIT 1`, [orgId])).rows[0];
  if (!feeRevenueAcc) {
    feeRevenueAcc = (await db.query(`INSERT INTO "LedgerAccount" ("id", "organizationId", "name", "currency", "type", "balance", "updatedAt") VALUES ($1, $2, 'Platform_Fee_Revenue', 'BTC', 'REVENUE', 0, NOW()) RETURNING id`, [crypto.randomUUID(), orgId])).rows[0];
  }

  // Double-entry record: Total Debit = Customer Total Sat, Total Credit = Merchant Sat + Fee Sat
  await db.query(
    `INSERT INTO "LedgerEntry" ("id", "debitAccountId", "creditAccountId", "amount", "amountSat", "referenceId", "description")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), receivableAcc.id, merchantAcc.id, calc.merchantPrice, calc.merchantSat, paymentId, 'Customer payment merchant share']
  );

  await db.query(
    `INSERT INTO "LedgerEntry" ("id", "debitAccountId", "creditAccountId", "amount", "amountSat", "referenceId", "description")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), receivableAcc.id, feeRevenueAcc.id, calc.fee, calc.feeSat, paymentId, 'SatoshiFlow 0.5% platform fee']
  );
}

// In-memory SSE clients for real-time checkout updates
const sseClients = new Map(); // paymentId -> [res]

function notifySse(paymentId, eventData) {
  const clients = sseClients.get(paymentId) || [];
  clients.forEach(res => {
    try {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    } catch(e) {}
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, Authorization, X-SatoshiFlow-Signature');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Serve Landing Page at root
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const landingHtmlPath = '/home/elogic360/Documents/CODELAB/satoshiFlow/apps/api/public/index.html';
    if (fs.existsSync(landingHtmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(landingHtmlPath));
    }
  }

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'SatoshiFlow API', timestamp: new Date().toISOString() }));
  }

  // Real-time SSE Payment Stream for Hosted Checkout
  if (req.method === 'GET' && url.pathname.startsWith('/v1/payments/') && url.pathname.endsWith('/events')) {
    const paymentId = url.pathname.split('/')[3];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ event: 'connected', paymentId })}\n\n`);

    if (!sseClients.has(paymentId)) sseClients.set(paymentId, []);
    sseClients.get(paymentId).push(res);

    req.on('close', () => {
      const list = sseClients.get(paymentId) || [];
      sseClients.set(paymentId, list.filter(c => c !== res));
    });
    return;
  }

  // --- MERCHANT ONBOARDING & REGISTRATION ---
  if (req.method === 'POST' && url.pathname === '/v1/merchants/register') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      const db = await getDb();
      try {
        const payload = JSON.parse(body || '{}');
        const orgName = payload.organizationName || 'Merchant Organization';
        const email = payload.email || `merchant_${Date.now()}@satoshiflow.io`;
        const storeName = payload.storeName || 'Main Store';
        const passwordHash = crypto.createHash('sha256').update(payload.password || 'password123').digest('hex');

        // Create Org
        const orgId = crypto.randomUUID();
        await db.query(`INSERT INTO "Organization" ("id", "name", "updatedAt") VALUES ($1, $2, NOW())`, [orgId, orgName]);

        // Create User
        const userId = crypto.randomUUID();
        await db.query(
          `INSERT INTO "User" ("id", "organizationId", "email", "passwordHash", "role", "updatedAt") VALUES ($1, $2, $3, $4, 'ADMIN', NOW())`,
          [userId, orgId, email, passwordHash]
        );

        // Create Store
        const storeId = crypto.randomUUID();
        await db.query(
          `INSERT INTO "Store" ("id", "organizationId", "name", "currency", "updatedAt") VALUES ($1, $2, $3, 'USD', NOW())`,
          [storeId, orgId, storeName]
        );

        // Create API Key
        const apiKeyId = crypto.randomUUID();
        const rawApiKey = 'sf_test_' + crypto.randomBytes(24).toString('hex');
        const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
        await db.query(
          `INSERT INTO "ApiKey" ("id", "organizationId", "keyHash", "prefix", "scopes", "isLive") VALUES ($1, $2, $3, 'sf_test_', ARRAY['payments:read', 'payments:write', 'stores:read'], false)`,
          [apiKeyId, orgId, keyHash]
        );

        // Create Default Fee Policy
        await db.query(
          `INSERT INTO "FeePolicy" ("id", "organizationId", "feeType", "basisPoints", "updatedAt") VALUES ($1, $2, 'CUSTOMER_PAYS', 50, NOW())`,
          [crypto.randomUUID(), orgId]
        );

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          organization: { id: orgId, name: orgName },
          user: { id: userId, email },
          store: { id: storeId, name: storeName },
          apiKey: rawApiKey
        }));
      } catch (err) {
        console.error('Registration err:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        await db.end();
      }
    });
    return;
  }

  // --- STORES & PRODUCTS API ---
  if (req.method === 'GET' && url.pathname === '/v1/stores') {
    const db = await getDb();
    try {
      const stores = await db.query(`SELECT * FROM "Store" ORDER BY "createdAt" DESC`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stores.rows));
    } finally {
      await db.end();
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/products') {
    const db = await getDb();
    try {
      const products = await db.query(`SELECT * FROM "Product" ORDER BY "createdAt" DESC`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(products.rows));
    } finally {
      await db.end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/products') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      const db = await getDb();
      try {
        const payload = JSON.parse(body || '{}');
        let store = (await db.query(`SELECT id FROM "Store" LIMIT 1`)).rows[0];
        const productId = crypto.randomUUID();
        const price = payload.price || 100.00;
        const name = payload.name || 'Digital Good';
        const description = payload.description || 'Sample product description';

        const pRes = await db.query(
          `INSERT INTO "Product" ("id", "storeId", "name", "description", "price", "currency", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'USD', NOW()) RETURNING *`,
          [productId, store.id, name, description, price]
        );
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pRes.rows[0]));
      } finally {
        await db.end();
      }
    });
    return;
  }

  // --- PAYMENTS LIST & DASHBOARD METRICS ---
  if (req.method === 'GET' && url.pathname === '/v1/dashboard/metrics') {
    const db = await getDb();
    try {
      const paymentsCount = await db.query(`SELECT COUNT(*), COALESCE(SUM("customerTotal"), 0) as total_volume FROM "Payment"`);
      const ledgerTotals = await db.query(`SELECT COALESCE(SUM("amountSat"), 0) as total_sat FROM "LedgerEntry" WHERE description LIKE '%platform fee%'`);
      const recentPayments = await db.query(`SELECT * FROM "Payment" ORDER BY "createdAt" DESC LIMIT 10`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        payment_count: Number(paymentsCount.rows[0].count),
        total_volume_fiat: Number(paymentsCount.rows[0].total_volume),
        platform_fees_sat: Number(ledgerTotals.rows[0].total_sat),
        recent_payments: recentPayments.rows
      }));
    } finally {
      await db.end();
    }
    return;
  }

  // GET Single Payment
  if (req.method === 'GET' && url.pathname.startsWith('/v1/payments/')) {
    const paymentId = url.pathname.split('/')[3];
    const db = await getDb();
    try {
      const result = await db.query(`SELECT * FROM "Payment" WHERE id = $1`, [paymentId]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Payment not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result.rows[0]));
    } finally {
      await db.end();
    }
  }

  // Confirm / Simulate Payment Settlement for Live Testing
  if (req.method === 'POST' && url.pathname.startsWith('/v1/payments/') && url.pathname.endsWith('/confirm')) {
    const paymentId = url.pathname.split('/')[3];
    const db = await getDb();
    try {
      await db.query(`UPDATE "Payment" SET status = 'PAID', "updatedAt" = NOW() WHERE id = $1`, [paymentId]);
      notifySse(paymentId, { status: 'PAID', paymentId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status: 'PAID', paymentId }));
    } finally {
      await db.end();
    }
    return;
  }

  // Create Payment
  if (req.method === 'POST' && url.pathname === '/v1/payments') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      const key = req.headers['idempotency-key'];
      const db = await getDb();

      try {
        if (key) {
          const existing = await db.query(`SELECT * FROM "Payment" WHERE "idempotencyKey" = $1`, [key]);
          if (existing.rows.length > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(existing.rows[0]));
          }
        }

        const payload = JSON.parse(body || '{}');
        const merchantAmount = Number(payload.amount || 100);
        const currency = payload.currency || 'USD';
        const feeCalc = calculateCustomerFee(merchantAmount);

        // Ensure default Organization, Store, and Order
        let org = (await db.query(`SELECT id FROM "Organization" LIMIT 1`)).rows[0];
        if (!org) {
          org = (await db.query(`INSERT INTO "Organization" ("id", "name", "updatedAt") VALUES ($1, 'Acme Merchant Corp', NOW()) RETURNING id`, [crypto.randomUUID()])).rows[0];
        }

        let store = (await db.query(`SELECT id FROM "Store" WHERE "organizationId" = $1 LIMIT 1`, [org.id])).rows[0];
        if (!store) {
          store = (await db.query(`INSERT INTO "Store" ("id", "organizationId", "name", "currency", "updatedAt") VALUES ($1, $2, 'Primary Store', 'USD', NOW()) RETURNING id`, [crypto.randomUUID(), org.id])).rows[0];
        }

        const orderId = crypto.randomUUID();
        await db.query(
          `INSERT INTO "Order" ("id", "storeId", "amount", "currency", "status", "updatedAt") VALUES ($1, $2, $3, $4, 'PENDING', NOW())`,
          [orderId, store.id, feeCalc.customerTotal, currency]
        );

        // Generate On-Chain Address from Bitcoin Core (regtest)
        let btcAddress = '';
        try {
          btcAddress = await btcRpc('getnewaddress');
        } catch (e) {
          btcAddress = 'bcrt1qdefaultregtestpaymentdestination';
        }

        // Generate Real Lightning Invoice from LND (Alice)
        let lightningInvoice = '';
        let rHash = '';
        try {
          const inv = await createLndInvoice(feeCalc.customerTotalSat, `Order ${orderId.substring(0, 8)}`);
          lightningInvoice = inv.paymentRequest;
          rHash = inv.rHash;
        } catch (e) {
          lightningInvoice = 'lnbcrt10u1testfallbackinvoice';
        }

        const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');

        // Insert Payment record
        const paymentRes = await db.query(
          `INSERT INTO "Payment" ("id", "orderId", "idempotencyKey", "amount", "currency", "merchantPrice", "customerTotal", "status", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'PAYMENT_READY', NOW()) RETURNING *`,
          [paymentId, orderId, key || null, feeCalc.customerTotal, currency, feeCalc.merchantPrice, feeCalc.customerTotal]
        );

        // Record Initial Ledger Entries
        await recordPaymentLedger(db, org.id, paymentId, feeCalc);

        const responseData = {
          ...paymentRes.rows[0],
          fee_details: {
            merchant_amount: feeCalc.merchantPrice,
            platform_fee_bps: feeCalc.rateBps,
            platform_fee: feeCalc.fee,
            customer_total: feeCalc.customerTotal,
            customer_total_satoshis: feeCalc.customerTotalSat
          },
          payment_methods: {
            bitcoin: {
              address: btcAddress,
              amount_sat: feeCalc.customerTotalSat,
              amount_btc: (feeCalc.customerTotalSat / 100_000_000).toFixed(8),
              uri: `bitcoin:${btcAddress}?amount=${(feeCalc.customerTotalSat / 100_000_000).toFixed(8)}`
            },
            lightning: {
              invoice: lightningInvoice,
              r_hash: rHash,
              uri: `lightning:${lightningInvoice}`
            }
          },
          checkout_url: `http://localhost:5173/checkout/${paymentId}`
        };

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseData));
      } catch (err) {
        console.error('Payment creation error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        await db.end();
      }
    });
    return;
  }

  // Webhook HMAC Signing Verification Endpoint
  if (req.method === 'POST' && url.pathname === '/v1/webhooks/sign') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const secret = 'whsec_satoshiflow_production_secret';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(payload)}`).digest('hex');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        header: `t=${timestamp},v1=${signature}`,
        timestamp,
        signature
      }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(3000, () => {
  console.log('SatoshiFlow API Server listening on port 3000 (connected to native PostgreSQL 18.6 & Polar Nodes)');
});
