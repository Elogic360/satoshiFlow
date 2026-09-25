export class FeeEngine {
  /**
   * Calculates the exact customer total including a 50 bps (0.5%) fee.
   * customer_total = merchant_price / (1 - 0.005)
   * 
   * @param merchantPrice The target price the merchant wants to receive (in smallest fiat unit, e.g. cents)
   * @param btcToFiatRate The current exchange rate (Fiat per 1 BTC)
   * @returns Exact amount in satoshis to charge the customer
   */
  static calculateCustomerTotalSatoshis(merchantPrice: number, btcToFiatRate: number): bigint {
    // 0.5% fee = merchant_price / 0.995
    const customerTotalFiat = merchantPrice / 0.995;
    
    // Convert to BTC, then to Satoshis (1 BTC = 100,000,000 Satoshis)
    // customerTotalFiat / btcToFiatRate = BTC amount
    const btcAmount = customerTotalFiat / btcToFiatRate;
    const satoshis = btcAmount * 100_000_000;
    
    // Return rounded exact satoshis
    return BigInt(Math.ceil(satoshis));
  }
}
