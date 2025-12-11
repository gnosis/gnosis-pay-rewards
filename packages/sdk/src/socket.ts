import type { Server as SocketIoServer } from 'socket.io';

import type { WeekSnapshotDocumentFieldsType } from './database/global-week-snapshot.js';
import type { GnosisPayTransactionFieldsType } from './database/gnosis-pay-transaction-zod.js';

export interface GnosisPayRewardsServerToClientEventsType {
  newTransaction: (data: GnosisPayTransactionFieldsType) => void;
  recentTransactions: (data: GnosisPayTransactionFieldsType[]) => void;
  newSpendTransaction: (data: GnosisPayTransactionFieldsType) => void;
  recentSpendTransactions: (data: GnosisPayTransactionFieldsType[]) => void;
  newRefundTransaction: (data: GnosisPayTransactionFieldsType) => void;
  recentRefundTransactions: (data: GnosisPayTransactionFieldsType[]) => void;
  currentWeekMetricsSnapshot: (data: WeekSnapshotDocumentFieldsType) => void;
  currentWeekMetricsSnapshotUpdated: (data: WeekSnapshotDocumentFieldsType) => void;
  weekMetricsSnapshotByTimestamp: (data: WeekSnapshotDocumentFieldsType | null) => void;
  allWeekMetricsSnapshots: (data: WeekSnapshotDocumentFieldsType[]) => void;
}

export type GnosisPayRewardsClientToServerEventsType = {
  getRecentTransactions: (limit: number) => void;
  getCurrentWeekMetricsSnapshot: () => void;
  getWeekMetricsSnapshotByTimestamp: (weekTimestamp: number) => void;
  getAllWeekMetricsSnapshots: () => void;
};

export interface GnosisPayRewardsInterServerEventsType {
  ping: () => void;
  pong: () => void;
}

export type GnosisPayRewardsServerInstanceType = SocketIoServer<
  GnosisPayRewardsClientToServerEventsType,
  GnosisPayRewardsServerToClientEventsType,
  GnosisPayRewardsInterServerEventsType,
  Record<string, unknown>
>;
