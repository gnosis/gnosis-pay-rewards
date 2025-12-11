import { SerializableErc20TokenType } from '@kpkpkg/apps-sdk/evm';
import { Address, isAddressEqual, PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';
import { getOraclePriceAtBlockNumber } from './oracle.js';
import { circleUsdcToken, GnoisPayTokenType, usdcBridgeToken } from './core/token-constants.js';
import { ConditionalReturnType } from './utils/types.js';

type TokenWithUsdPriceType = SerializableErc20TokenType & { price: number };

/**
 * Get the token prices at a specific block number.
 * Assumes USDC and USDC.e at 1 USD each.
 * @param client - The public client
 * @param blockNumber - The block number
 * @param tokens - The tokens to get the prices for
 * @returns The same tokens with the price property added
 */
export async function getTokenPricesAtBlockNumber({
  client,
  blockNumber,
  tokens,
}: {
  client: PublicClient<Transport, typeof gnosis>;
  blockNumber: bigint;
  tokens: GnoisPayTokenType[];
}): Promise<ConditionalReturnType<true, TokenWithUsdPriceType[], Error> | ConditionalReturnType<false, null, Error>> {
  try {
    const tokenWithUsdPrice = await Promise.all(
      tokens.map(async (token) => {
        let price = 1;

        if (
          isAddressEqual(token.address, usdcBridgeToken.address) ||
          isAddressEqual(token.address, circleUsdcToken.address)
        ) {
          price = 1;
        } else {
          const { data, error } = await getOraclePriceAtBlockNumber({
            oracle: token.oracle as Address,
            blockNumber,
            client,
          });

          if (error) {
            throw error;
          }

          price = data.price;
        }

        return {
          ...token,
          price: Number(price.toFixed(2)),
        };
      }),
    );

    return {
      error: null,
      data: tokenWithUsdPrice as TokenWithUsdPriceType[],
    };
  } catch (error) {
    return {
      error: error as Error,
      data: null,
    };
  }
}
