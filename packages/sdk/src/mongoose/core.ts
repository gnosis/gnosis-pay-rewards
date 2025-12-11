import mongoose, { ConnectOptions, Mongoose } from 'mongoose';

import { BlockModelType, createBlockModel, createProcessedBlockModel, ProcessedBlockModelType } from './models/block';
import { createGnosisPayRewardDistributionModel, RewardTransactionModelType } from './models/reward-transaction';
import { createGnosisPaySafeModel, GnosisPaySafeModelType } from './models/gnosis-pay-safe';
import { createMetriSafeModel, MetriSafeModelType } from './models/gnosis-metri-safe';
import { createTokenPriceSnapshotModel, TokenPriceSnapshotModelType } from './models/token-price-snapshot';
import { createGnosisPayTransactionModel, GnosisPayTransactionModelType } from './models/gnosis-pay-transaction';
import { createTokenBalanceSnapshotModel, TokenBalanceSnapshotModelType } from './models/token-balance-snapshot';
import { createTokenModel, TokenModelType } from './models/token';
import {
  createSafeWeekRewardsSnapshotModel,
  SafeWeekRewardsSnapshotModelType,
} from './models/safe-week-rewards-snapshot';
import { createWeekMetricsSnapshotModel, WeekMetricsSnapshotModelType } from './models/global-week-metrics-snapshot';

export type CreateModelsReturnType = {
  blockModel: BlockModelType;
  processedBlockModel: ProcessedBlockModelType;
  rewardTransactionModel: RewardTransactionModelType;
  gnosisPaySafeModel: GnosisPaySafeModelType;
  metriSafeModel: MetriSafeModelType;
  tokenPriceModel: TokenPriceSnapshotModelType;
  gnosisPayTransactionModel: GnosisPayTransactionModelType;
  tokenBalanceSnapshotModel: TokenBalanceSnapshotModelType;
  tokenModel: TokenModelType;
  safeWeekRewardsSnapshotModel: SafeWeekRewardsSnapshotModelType;
  weekMetricsSnapshotModel: WeekMetricsSnapshotModelType;
};

/**
 * Create all mongoose models for the application
 * @param mongooseConnection - The mongoose connection to use
 * @returns An object containing all created models
 */
export function createModels(mongooseConnection: Mongoose): CreateModelsReturnType {
  return {
    blockModel: createBlockModel(mongooseConnection),
    processedBlockModel: createProcessedBlockModel(mongooseConnection),
    rewardTransactionModel: createGnosisPayRewardDistributionModel(mongooseConnection),
    gnosisPaySafeModel: createGnosisPaySafeModel(mongooseConnection),
    metriSafeModel: createMetriSafeModel(mongooseConnection),
    tokenPriceModel: createTokenPriceSnapshotModel(mongooseConnection),
    gnosisPayTransactionModel: createGnosisPayTransactionModel(mongooseConnection),
    tokenBalanceSnapshotModel: createTokenBalanceSnapshotModel(mongooseConnection),
    tokenModel: createTokenModel(mongooseConnection),
    safeWeekRewardsSnapshotModel: createSafeWeekRewardsSnapshotModel(mongooseConnection),
    weekMetricsSnapshotModel: createWeekMetricsSnapshotModel(mongooseConnection),
  };
}

declare global {
  var mongoose: {
    conn: Mongoose | null;
    promise: Promise<Mongoose> | null;
  }; // This must be a `var` and not a `let / const`
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function createConnection(
  connectionString: string,
  opts: ConnectOptions = {
    bufferCommands: false,
    // connectTimeoutMS: 10000,
  },
): Promise<Mongoose> {
  if (cached.conn) {
    return cached.conn;
  }
  if (!cached.promise) {
    cached.promise = mongoose.connect(connectionString, opts).then((mongoose) => {
      return mongoose;
    });
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}
