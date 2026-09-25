const http = require('http');
const crypto = require('crypto');

const idempotencyMap = new Map();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  }

  if (req.method === 'POST' && req.url === '/v1/payments') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      const key = req.headers['idempotency-key'];
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Idempotency-Key header is required' }));
      }

      if (idempotencyMap.has(key)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(idempotencyMap.get(key)));
      }

      const payload = JSON.parse(body);
      const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
      const payment = { id: paymentId, amount: payload.amount, currency: payload.currency, status: 'CREATED' };
      
      console.log(`[Ledger] Creating double-entry for payment ${paymentId}`);
      console.log(`[Worker] Payment ${paymentId} enqueued for processing...`);

      idempotencyMap.set(key, payment);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payment));
    });
    return;
  }
  
  if (req.method === 'POST' && req.url === '/v1/webhooks/sign') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      const payload = JSON.parse(body);
      const secret = 'test-secret';
      const timestamp = Date.now().toString();
      const dataToSign = `${timestamp}.${JSON.stringify(payload)}`;
      const signature = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ signature: `t=${timestamp},v1=${signature}` }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(3000, () => console.log('API listening on port 3000'));
