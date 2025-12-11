import { getQuote, OrderKind } from '@cowprotocol/cow-sdk';
import { Address, formatUnits, isAddressEqual, parseUnits, PublicClient, Transport, zeroAddress } from 'viem';
import { gnosis } from 'viem/chains';
import { getOraclePriceAtBlockNumber } from './oracle';
import {
  circleUsdcToken,
  gCrcToken,
  gCrcTokenForPriceProvider,
  GnoisPayTokenType,
  usdcBridgeToken,
} from './core/token-constants';
import { TokenFieldsType } from './database/token-zod';

/**
 * Token type that can be used with TokenPriceProvider.
 * Accepts both GnoisPayTokenType (from constants) and TokenFieldsType (from database).
 */
type TokenField = GnoisPayTokenType | TokenFieldsType;

/**
 * Parameters for the price method.
 * If tokenB is not provided, defaults to USD (using USDC as reference).
 */
type PriceParams = {
  tokenA: TokenField;
  tokenB?: TokenField;
  blockNumber?: bigint;
};

/**
 * Parameters for the value method.
 * If tokenB is not provided, defaults to USD (using USDC as reference).
 */
type ValueParams = {
  tokenA: TokenField;
  tokenB?: TokenField;
  blockNumber?: bigint;
  amount: number;
};

/**
 * TokenPriceProvider class for converting between Gnosis tokens.
 * Provides methods to get USD prices and convert between token pairs.
 */
export class TokenPriceProvider {
  private client: PublicClient<Transport, typeof gnosis>;

  constructor(client: PublicClient<Transport, typeof gnosis>) {
    this.client = client;
  }

  /**
   * Internal method to get the USD price of a token.
   * @param token - The token to get the price for
   * @param blockNumber - Optional block number to get the price at. If not provided, uses the latest block.
   * @returns The USD price of the token
   * @throws Error if the token oracle is not available or price fetch fails
   */
  private async priceUSD(token: TokenField, blockNumber?: bigint): Promise<number> {
    // USDC and USDC.e are always 1 USD
    if (
      isAddressEqual(token.address as Address, usdcBridgeToken.address) ||
      isAddressEqual(token.address as Address, circleUsdcToken.address)
    ) {
      return 1;
    }

    // For gCrcToken, use CoW Protocol to get CRC/USD price or use the cached price
    if (
      isAddressEqual(token.address as Address, gCrcToken.address) ||
      isAddressEqual(token.address as Address, gCrcTokenForPriceProvider.address)
    ) {
      const crcAmount = parseUnits('1', gCrcTokenForPriceProvider.decimals).toString();

      const { result: quoteResult } = await getQuote(
        {
          amount: crcAmount,
          sellToken: gCrcTokenForPriceProvider.address as Address, // this token has liquidity on CoW Protocol
          sellTokenDecimals: gCrcTokenForPriceProvider.decimals,
          buyTokenDecimals: circleUsdcToken.decimals,
          buyToken: circleUsdcToken.address as Address,
          kind: OrderKind.SELL,
        },
        {
          account: zeroAddress,
          appCode: '0x0000000000000000000000000000000000000000000000000000000000000000',
          chainId: gnosis.id,
        },
      );

      const buyAmountUSD = Number(
        formatUnits(quoteResult.amountsAndCosts.beforeNetworkCosts.buyAmount, circleUsdcToken.decimals),
      );

      return buyAmountUSD;
    }

    // Check if token has an oracle
    if (!token.oracle) {
      throw new Error(`Token ${token.symbol} (${token.address}) does not have an oracle address`);
    }

    // Get block number if not provided
    const targetBlockNumber = blockNumber ?? (await this.client.getBlockNumber());

    const { data, error } = await getOraclePriceAtBlockNumber({
      client: this.client,
      blockNumber: targetBlockNumber,
      oracle: token.oracle as Address,
    });

    if (error || !data) {
      throw new Error(`Failed to get price for token ${token.symbol}: ${error?.message ?? 'Unknown error'}`);
    }

    return data.price;
  }

  /**
   * Get the USD price of a token (overload for positional parameters).
   * @param token - The token to get the price for
   * @param blockNumber - Optional block number to get the price at. If not provided, uses the latest block.
   * @returns The USD price of the token
   * @throws Error if the token oracle is not available or price fetch fails
   */
  async price(token: TokenField, blockNumber?: bigint): Promise<number>;
  /**
   * Get the price of tokenA, defaulting to USD if tokenB is not provided (overload for object parameter).
   * @param params - Object containing tokenA, optional tokenB, and optional blockNumber
   * @returns The price ratio (tokenA price / tokenB price) or tokenA price in USD if tokenB is not provided
   * @throws Error if either token's price cannot be fetched
   */
  async price(params: PriceParams): Promise<number>;
  async price(tokenOrParams: TokenField | PriceParams, blockNumber?: bigint): Promise<number> {
    // Check if it's a PriceParams object (has tokenA property)
    if (typeof tokenOrParams === 'object' && 'tokenA' in tokenOrParams) {
      // Handle object parameter
      const params = tokenOrParams as PriceParams;
      const { tokenA, tokenB, blockNumber: paramBlockNumber } = params;

      // If tokenB is not provided, default to USD (using USDC as reference)
      if (!tokenB) {
        return await this.priceUSD(tokenA, paramBlockNumber);
      }

      // Get prices for both tokens
      const priceA = await this.priceUSD(tokenA, paramBlockNumber);
      const priceB = await this.priceUSD(tokenB, paramBlockNumber);

      if (priceB === 0) {
        throw new Error(`Token ${tokenB.symbol} has a price of 0, cannot calculate ratio`);
      }

      return priceA / priceB;
    }

    // Handle positional parameters (token, blockNumber?)
    const token = tokenOrParams as TokenField;
    return await this.priceUSD(token, blockNumber);
  }

  /**
   * Get the value of an amount of tokenA in terms of tokenB (or USD if tokenB is not provided).
   * @param params - Object containing tokenA, amount, optional tokenB, and optional blockNumber
   * @returns The value of the amount in terms of tokenB (or USD)
   * @throws Error if either token's price cannot be fetched
   */
  async value(params: ValueParams): Promise<number> {
    const { tokenA, tokenB, blockNumber, amount } = params;

    // Get the price ratio
    const price = await this.price({ tokenA, tokenB, blockNumber });

    return amount * price;
  }
}
