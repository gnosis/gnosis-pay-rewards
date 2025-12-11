import { ClientSession, Model, Mongoose, Schema } from 'mongoose';
import { isHash } from 'viem';

import { gnosisPayTransactionModelName } from './model-config.js';
import { WeekSnapshotDocumentFieldsType } from '../../database/global-week-snapshot.js';
import { getCurrentWeekId, toWeekId, WeekIdFormatType } from '../../week-functions.js';
import { mongooseSchemaWeekIdField } from './shared-schema-fields.js';

export const weekMetricsSnapshotModelName = 'WeekMetricsSnapshot' as const;
export const weekMetricsSnapshotCollectionName = 'week_metrics_snapshots' as const;

export const weekMetricsSnapshotSchema = new Schema<WeekSnapshotDocumentFieldsType>(
  {
    week: mongooseSchemaWeekIdField,
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
  {
    collection: weekMetricsSnapshotCollectionName,
    timestamps: true,
  },
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
).index({ week: 1 }, { unique: true });

export type WeekMetricsSnapshotModelType = Model<WeekSnapshotDocumentFieldsType>;

export function createWeekMetricsSnapshotModel(mongoose: Mongoose): WeekMetricsSnapshotModelType {
  // Return cached model if it exists
  return (
    mongoose.models[weekMetricsSnapshotModelName] ??
    mongoose.model(weekMetricsSnapshotModelName, weekMetricsSnapshotSchema)
  );
}

type GetOrCreateWeekMetricsSnapshotDocumentParams =
  | { unixTimestamp: number; week?: never }
  | {
      unixTimestamp?: never;
      week: WeekIdFormatType;
    };

export async function createWeekMetricsSnapshotDocument(
  model: WeekMetricsSnapshotModelType,
  payload: GetOrCreateWeekMetricsSnapshotDocumentParams,
  mongooseSession?: ClientSession,
) {
  const { unixTimestamp, week } = payload;

  if ((unixTimestamp && week) || (!unixTimestamp && !week)) {
    throw new Error('Either unixTimestamp or week must be provided, but not both.');
  }

  const yyyyMMDD = week ?? toWeekId(unixTimestamp!);

  const document = await model.findOne(
    { week: yyyyMMDD },
    {},
    {
      session: mongooseSession,
    },
  );

  if (document !== null) {
    return document;
  }

  return new model<WeekSnapshotDocumentFieldsType>({
    transactions: [],
    week: yyyyMMDD,
  }).save({ session: mongooseSession });
}

export async function getCurrentWeekMetricsSnapshotDocument(model: Model<WeekSnapshotDocumentFieldsType>) {
  return createWeekMetricsSnapshotDocument(model, {
    week: getCurrentWeekId(),
  });
}
