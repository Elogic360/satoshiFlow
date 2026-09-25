import { LightningProvider } from '../packages/blockchain/src/LightningProvider';

async function verify() {
  console.log('Verifying Lightning ...');
  const macaroonHex = '0201036c6e6402f801030a10128d571ec2cfe8e306b5bdca9b8003531201301a160a0761646472657373120472656164120577726974651a130a04696e666f120472656164120577726974651a170a08696e766f69636573120472656164120577726974651a210a086d616361726f6f6e120867656e6572617465120472656164120577726974651a160a076d657373616765120472656164120577726974651a170a086f6666636861696e120472656164120577726974651a160a076f6e636861696e120472656164120577726974651a140a057065657273120472656164120577726974651a180a067369676e6572120867656e65726174651204726561640000062088a7b43fac311eecb4257520b651e8c0781fa4d01e822336c3482f825b328f13';
  
  const ln = new LightningProvider({
    url: 'https://127.0.0.1:8082',
    macaroonHex,
  });

  try {
    const info = await ln.getInfo();
    console.log(`LND Node Alias: ${info.alias}, Height: ${info.block_height}`);

    const invoice = await ln.createInvoice(1000, 'Test Invoice');
    console.log(`Created Invoice (1000 sats): ${invoice.payment_request}`);

    // Decode invoice just by fetching its status by rHash
    const rHashHex = Buffer.from(invoice.r_hash, 'base64').toString('hex');
    const invDetails = await ln.getInvoice(rHashHex);
    console.log(`Invoice Status: ${invDetails.state}`);
  } catch (error) {
    console.error('Lightning verification failed:', error);
  }
}

verify();
