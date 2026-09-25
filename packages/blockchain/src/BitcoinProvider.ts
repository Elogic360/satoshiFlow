import axios from 'axios';

export interface BitcoinProviderConfig {
  url: string;
  user: string;
  pass: string;
}

export class BitcoinProvider {
  private url: string;
  private auth: string;

  constructor(config: BitcoinProviderConfig) {
    this.url = config.url;
    this.auth = Buffer.from(`${config.user}:${config.pass}`).toString('base64');
  }

  private async rpcCall(method: string, params: any[] = []) {
    const response = await axios.post(
      this.url,
      {
        jsonrpc: '1.0',
        id: 'ts-client',
        method,
        params,
      },
      {
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Basic ${this.auth}`,
        },
      }
    );
    if (response.data.error) {
      throw new Error(`RPC error: ${JSON.stringify(response.data.error)}`);
    }
    return response.data.result;
  }

  async getNewAddress(): Promise<string> {
    return this.rpcCall('getnewaddress');
  }

  async getBalance(): Promise<number> {
    return this.rpcCall('getbalance');
  }

  async sendToAddress(address: string, amount: number): Promise<string> {
    return this.rpcCall('sendtoaddress', [address, amount]);
  }

  async getTransaction(txid: string): Promise<any> {
    return this.rpcCall('gettransaction', [txid]);
  }

  async mineBlocks(numBlocks: number, address: string): Promise<string[]> {
    return this.rpcCall('generatetoaddress', [numBlocks, address]);
  }

  async watchAddress(address: string): Promise<void> {
    await this.rpcCall('importaddress', [address, '', false]);
  }
}
