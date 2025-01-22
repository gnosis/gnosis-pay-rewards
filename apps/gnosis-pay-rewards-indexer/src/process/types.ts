import {
  GnosisPayTransactionFieldsType_Populated,
  GnosisPayTransactionFieldsType_Unpopulated,
  WeekCashbackRewardDocumentFieldsType_Populated,
  WeekSnapshotDocumentFieldsType,
} from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  GnosisPaySafeAddressDocumentFieldsType_Unpopulated,
  GnosisTokenBalanceSnapshotModelType,
  WeekCashbackRewardModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { Model } from 'mongoose';
import { PublicClient, Transport } from 'viem';
import { gnosis } from 'viem/chains';

export type MongooseConfiguredModels = {
  gnosisPayTransactionModel: Model<GnosisPayTransactionFieldsType_Unpopulated>;
  gnosisPaySafeAddressModel: Model<GnosisPaySafeAddressDocumentFieldsType_Unpopulated>;
  weekCashbackRewardModel: WeekCashbackRewardModelType;
  weekMetricsSnapshotModel: Model<WeekSnapshotDocumentFieldsType>;
  gnosisTokenBalanceSnapshotModel: GnosisTokenBalanceSnapshotModelType;
};

export type GnosisChainPublicClient = PublicClient<Transport, typeof gnosis>;

export type ProcessLogFunctionParams<LogType extends Record<string, unknown>> = {
  client: GnosisChainPublicClient;
  log: LogType;
  mongooseModels: MongooseConfiguredModels;
};

export type ProcessLogFnDataType = {
  gnosisPayTransaction: GnosisPayTransactionFieldsType_Populated;
  weekCashbackReward: WeekCashbackRewardDocumentFieldsType_Populated;
  weekMetricsSnapshot: WeekSnapshotDocumentFieldsType;
};
