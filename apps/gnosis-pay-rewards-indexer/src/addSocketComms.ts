import { GnosisPayTransactionFieldsType_Populated } from '@karpatkey/gnosis-pay-rewards-sdk';
import {
  getCurrentWeekMetricsSnapshotDocument,
  createWeekMetricsSnapshotDocument,
  GnosisPayTransactionModelType,
  WeekMetricsSnapshotModelType,
} from '@karpatkey/gnosis-pay-rewards-sdk/mongoose';
import { buildSocketIoServer } from './server.js';
import { MongooseConfiguredModels } from './process/types.js';

export function addSocketComms({
  socketIoServer,
  mongooseModels,
}: {
  socketIoServer: ReturnType<typeof buildSocketIoServer>;
  mongooseModels: MongooseConfiguredModels;
}) {
  const { gnosisPayTransactionModel, weekMetricsSnapshotModel } = mongooseModels;

  // Emit the 10 recent pending rewards to the UI when a client connects
  socketIoServer.on('connection', async (socketClient) => {
    socketClient.on('disconnect', () => {
      console.log('Client disconnected');
    });

    socketClient.on('getRecentTransactions', async (limit: number) => {
      const spendTransactions = ((await gnosisPayTransactionModel
        .find()
        .populate({
          path: 'amountToken',
        })
        .limit(limit)
        .sort({ blockNumber: -1 })
        .lean()) as unknown) as GnosisPayTransactionFieldsType_Populated[];
      socketClient.emit('recentTransactions', spendTransactions);
    });

    socketClient.on('getCurrentWeekMetricsSnapshot', async () => {
      const weekData = await getCurrentWeekMetricsSnapshotDocument(weekMetricsSnapshotModel);
      socketClient.emit('currentWeekMetricsSnapshot', weekData.toJSON());
    });

    socketClient.on('getWeekMetricsSnapshotByTimestamp', async (weekTimestamp: number) => {
      const weekData = await createWeekMetricsSnapshotDocument({
        weekMetricsSnapshotModel,
        unixTimestamp: weekTimestamp,
      });
      socketClient.emit('weekMetricsSnapshotByTimestamp', weekData.toJSON());
    });

    socketClient.on('getAllWeekMetricsSnapshots', async () => {
      const allWeekData = await weekMetricsSnapshotModel.find().sort({ timestamp: 1 });
      socketClient.emit(
        'allWeekMetricsSnapshots',
        allWeekData.map((w) => w.toJSON())
      );
    });
  });

  return socketIoServer;
}
