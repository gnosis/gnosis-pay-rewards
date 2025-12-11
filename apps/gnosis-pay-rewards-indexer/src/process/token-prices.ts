import { getTokenPricesAtBlockNumber, TokenPriceSnapshotFieldsType } from '@kpk/gnosis-pay-rewards-sdk';
import type { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import type { Logger } from 'winston';

import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import type { GnosisChainPublicClient } from './types.ts';
import type { RedisCache } from '../lib/redis-cache.ts';
import { CachedTokenPriceProvider } from '../lib/cached-token-price-provider.ts';

type HandleBlockParamsType = {
  blockNumber: bigint;
  client: GnosisChainPublicClient;
  logger?: Logger;
  mongooseModels: CreateModelsReturnType;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
};

/**
 * Records token prices for all tokens that have oracle addresses
 * For gCRC token (which doesn't have an oracle), uses CachedTokenPriceProvider
 */
export async function handleTokenPriceRecording(params: HandleBlockParamsType) {
  const { blockNumber, client, logger, mongooseModels, redisCache } = params;

  const childLogger = logger?.child({
    function: 'handleTokenPriceRecording',
  });

  // The block has been already handled
  const blockNumberHasTokenPrices = await mongooseModels.tokenPriceModel.find({
    blockNumber: Number(blockNumber),
  });

  if (blockNumberHasTokenPrices.length > 0) {
    childLogger?.info(`block ${blockNumber} has already been handled`);
    return;
  }

  // Get all tokens
  const tokens = await mongooseModels.tokenModel.find().lean();
  const tokensMapped = tokens.map((token) => ({
    ...token,
    address: token._id,
  }));

  // Separate tokens with oracles from tokens without (like gCRC)
  const tokensWithOracles = tokensMapped.filter((token) => token.oracle);
  const tokensWithoutOracles = tokensMapped.filter((token) => !token.oracle);

  // Get prices for tokens with oracles
  const { data: tokensWithPrices, error } = await getTokenPricesAtBlockNumber({
    client,
    blockNumber,
    tokens: tokensWithOracles,
  });

  if (error) {
    throw error;
  }

  // Get prices for tokens without oracles (like gCRC) using CachedTokenPriceProvider
  const priceProvider = new CachedTokenPriceProvider(client, redisCache);
  const tokensWithoutOraclePrices = await Promise.all(
    tokensWithoutOracles.map(async (token) => {
      try {
        const price = await priceProvider.price({ tokenA: token, blockNumber });
        return {
          ...token,
          price: Number(price.toFixed(2)),
        };
      } catch (error) {
        childLogger?.error(`Failed to get price for token ${token.symbol} (${token.address}):`, error);
        throw error;
      }
    }),
  );

  // Combine all token prices
  const allTokensWithPrices = [...(tokensWithPrices || []), ...tokensWithoutOraclePrices];

  const tokenPricesDocumentsToSave: TokenPriceSnapshotFieldsType[] = allTokensWithPrices.map((tokenWithPrice) => ({
    _id: mongooseModels.tokenPriceModel.createDocumentId(
      Number(blockNumber),
      tokenWithPrice.address,
    ),
    price: tokenWithPrice.price,
    token: tokenWithPrice.address,
    block: Number(blockNumber),
  }));

  const savedTokenPricesDocuments = await mongooseModels.tokenPriceModel.create(
    tokenPricesDocumentsToSave,
  );

  return savedTokenPricesDocuments;
}
