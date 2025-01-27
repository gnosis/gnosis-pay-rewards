/**
 * Token price document fields type
 */
export interface GnosisPayTokenPriceDocumentFieldsType {
  /**
   * _id: `${number}/0x${string}`; // Format: `${blockNumber}/0x${tokenAddress}`
   */
  _id: `${number}/0x${string}`;
  /**
   * Price in USD
   */
  price: number;
  /**
   * Block number
   */
  blockNumber: number;
  /**
   * Unix timestamp
   */
  blockTimestamp: number;
  /**
   * ISO date
   */
  blockTimestampIso: Date;
  /**
   * Reference to the token
   */
  token: string;
}
