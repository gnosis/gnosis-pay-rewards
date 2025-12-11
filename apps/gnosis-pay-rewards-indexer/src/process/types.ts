import {
  GnosisPayTransactionFieldsType,
  SafeWeekRewardsSnapshotDocumentFieldsType,
  WeekSnapshotDocumentFieldsType,
} from '@kpk/gnosis-pay-rewards-sdk';
import { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';
import type { BlockInfoProvider } from '../lib/block-info-provider.ts';
import type { PublicClient, Transport } from 'viem';
import type { gnosis } from 'viem/chains';
import type { RedisCache } from '../lib/redis-cache.ts';

export type GnosisChainPublicClient = PublicClient<Transport, typeof gnosis>;

export type ProcessLogFunctionParams<LogType extends Record<string, unknown>> = {
  client: GnosisChainPublicClient;
  log: LogType;
  mongooseModels: CreateModelsReturnType;
  blockInfoProvider: BlockInfoProvider;
  redisCache: RedisCache;
};

export type ProcessLogFnDataType = {
  gnosisPayTransaction: GnosisPayTransactionFieldsType;
  weekMetricsSnapshot: WeekSnapshotDocumentFieldsType;
  safeWeekRewardsSnapshot: SafeWeekRewardsSnapshotDocumentFieldsType;
};
