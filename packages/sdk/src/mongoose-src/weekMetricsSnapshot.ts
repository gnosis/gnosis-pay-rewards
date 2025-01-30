import { ClientSession, Model, Mongoose, Schema } from 'mongoose';
import { isHash } from 'viem';

import { gnosisPayTransactionModelName } from './gnosisPayTransaction.js';
import { WeekSnapshotDocumentFieldsType } from '../database/weekSnapshot.js';
import { WeekIdFormatType, getCurrentWeekId, toWeekId } from '../week-functions';

export const weekDataSchema = new Schema<WeekSnapshotDocumentFieldsType>(
  {
    date: { type: String, required: true },
    netUsdVolume: { type: Number, required: true, default: 0 },
    transactions: [
      {
        ref: gnosisPayTransactionModelName,
        type: String,
        required: true,
        validate: {
          validator: (value: string) => isHash(value),
          message: '{VALUE} is not a valid hash',
        },
      },
    ],
  },
  { timestamps: true },
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
).index({ date: 1 }, { unique: true });

export const weekMetricsSnapshotModelName = 'WeekMetricsSnapshot' as const;

export type WeekMetricsSnapshotModelType = Model<WeekSnapshotDocumentFieldsType>;

export function createWeekMetricsSnapshotModel(mongooseConnection: Mongoose): WeekMetricsSnapshotModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[weekMetricsSnapshotModelName]) {
    return mongooseConnection.models[weekMetricsSnapshotModelName] as WeekMetricsSnapshotModelType;
  }

  return mongooseConnection.model(weekMetricsSnapshotModelName, weekDataSchema);
}

type GetOrCreateWeekMetricsSnapshotDocumentParams =
  | { unixTimestamp: number; weekId?: never; weekMetricsSnapshotModel: Model<WeekSnapshotDocumentFieldsType> }
  | {
      unixTimestamp?: never;
      weekId: WeekIdFormatType;
      weekMetricsSnapshotModel: Model<WeekSnapshotDocumentFieldsType>;
    };

export async function createWeekMetricsSnapshotDocument(
  { weekMetricsSnapshotModel, unixTimestamp, weekId }: GetOrCreateWeekMetricsSnapshotDocumentParams,
  mongooseSession?: ClientSession,
) {
  if ((unixTimestamp && weekId) || (!unixTimestamp && !weekId)) {
    throw new Error('Either unixTimestamp or weekId must be provided, but not both.');
  }

  const yyyyMMDD = weekId ?? toWeekId(unixTimestamp!);

  const weekMetricsSnapshotDocument = await weekMetricsSnapshotModel.findOne(
    { date: yyyyMMDD },
    {},
    { session: mongooseSession },
  );

  if (weekMetricsSnapshotDocument !== null) {
    return weekMetricsSnapshotDocument;
  }

  return new weekMetricsSnapshotModel<WeekSnapshotDocumentFieldsType>({
    date: yyyyMMDD,
    netUsdVolume: 0,
    transactions: [],
    week: yyyyMMDD,
  }).save({ session: mongooseSession });
}

export async function getCurrentWeekMetricsSnapshotDocument(
  weekMetricsSnapshotModel: Model<WeekSnapshotDocumentFieldsType>,
) {
  return createWeekMetricsSnapshotDocument({
    weekMetricsSnapshotModel,
    weekId: getCurrentWeekId(),
  });
}
