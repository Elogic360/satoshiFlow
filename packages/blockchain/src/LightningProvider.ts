import axios from 'axios';
import * as https from 'https';

export interface LightningProviderConfig {
  url: string;
  macaroonHex: string;
}

export class LightningProvider {
  private url: string;
  private macaroon: string;
  private httpsAgent: https.Agent;

  constructor(config: LightningProviderConfig) {
    this.url = config.url;
    this.macaroon = config.macaroonHex;
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });
  }

  private async restCall(method: 'GET' | 'POST', endpoint: string, data?: any) {
    const response = await axios({
      method,
      url: `${this.url}${endpoint}`,
      data,
      headers: {
        'Grpc-Metadata-macaroon': this.macaroon,
      },
      httpsAgent: this.httpsAgent,
    });
    return response.data;
  }

  async getInfo(): Promise<any> {
    return this.restCall('GET', '/v1/getinfo');
  }

  async getBalance(): Promise<any> {
    return this.restCall('GET', '/v1/balance/channels');
  }

  async createInvoice(valueSats: number, memo: string): Promise<any> {
    return this.restCall('POST', '/v1/invoices', { value: valueSats, memo });
  }

  async getInvoice(rHashStr: string): Promise<any> {
    const rHashStrHex = Buffer.from(rHashStr, 'hex').toString('hex'); // ensure it's hex, though wait, LND expects hex URL param
    // Let's assume rHashStr is hex
    return this.restCall('GET', `/v1/invoice/${rHashStr}`);
  }

  async payInvoice(paymentRequest: string): Promise<any> {
    return this.restCall('POST', '/v1/channels/transactions', { payment_request: paymentRequest });
  }
}
