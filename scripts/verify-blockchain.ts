import { BitcoinProvider } from '../packages/blockchain/src/BitcoinProvider';

async function verify() {
  console.log('Verifying Bitcoin ...');
  const btc = new BitcoinProvider({
    url: 'http://127.0.0.1:18447/',
    user: 'polaruser',
    pass: 'polarpass',
  });

  try {
    const bal = await btc.getBalance();
    console.log(`Current Balance: ${bal}`);

    const address = await btc.getNewAddress();
    console.log(`Generated Address: ${address}`);

    const txid = await btc.sendToAddress(address, 1.5);
    console.log(`Sent 1.5 BTC to ${address}, txid: ${txid}`);

    const mined = await btc.mineBlocks(1, address);
    console.log(`Mined 1 block: ${mined[0]}`);

    const tx = await btc.getTransaction(txid);
    console.log(`Transaction confirmations: ${tx.confirmations}`);
  } catch (error) {
    console.error('Bitcoin verification failed:', error);
  }
}

verify();
