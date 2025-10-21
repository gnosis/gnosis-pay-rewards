/* eslint-disable @typescript-eslint/no-explicit-any */
import { Address, isAddress } from 'viem';
import { ClientSession, HydratedDocument, Model, Mongoose, Schema } from 'mongoose';
import { WeekCashbackRewardDocumentFieldsType_Unpopulated } from '../database/weekReward';
import { WeekIdFormatType, weekIdFormat } from '../week-functions';
import { gnosisTokenBalanceSnapshotModelName } from './gnosisTokenBalanceSnapshot';
import { mongooseSchemaAddressField } from './sharedSchemaFields';
import { gnosisPaySafeAddressModelName } from './gnosisPaySafeAddress';
import { gnosisPayTransactionModelName } from './gnosisPayTransaction';

const weekCashbackRewardSchema = new Schema<WeekCashbackRewardDocumentFieldsType_Unpopulated>(
  {
    _id: {
      type: String,
      required: true,
      validate(value: string) {
        const [isoWeek, address] = value.split('/');

        return isoWeek.match(/^\d{4}-\d{2}-\d{2}$/) !== null && isAddress(address);
      },
    },
    safe: {
      ...mongooseSchemaAddressField,
      ref: gnosisPaySafeAddressModelName,
      required: true,
    },
    week: {
      type: String,
      required: true,
    },
    netUsdVolume: {
      type: Number,
      required: true,
    },
    maxGnoBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    minGnoBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    estimatedReward: {
      type: Number,
      required: true,
      default: 0,
    },
    earnedReward: {
      type: Number,
      required: false,
      default: null,
    },
    transactions: [
      {
        type: String,
        ref: gnosisPayTransactionModelName,
      },
    ],
    gnoBalanceSnapshots: [
      {
        type: String,
        ref: gnosisTokenBalanceSnapshotModelName,
      },
    ],
  },
  { timestamps: true },
)
  // Critical indexes for performance
  .index({ week: 1 }) // For queries by week
  .index({ safe: 1, week: -1 }) // For queries by safe address and week (most recent first)
  .index({ safe: 1 }) // For queries by safe address only
  .index({ netUsdVolume: -1 }) // For sorting by volume
  .index({ estimatedReward: -1 }); // For sorting by estimated reward

const modelName = 'WeekCashbackReward' as const;

/**
 * Create a document id for the week cashback reward in the format of week/address
 * @param week - e.g. 2024-03-01
 * @param address - e.g. 0x123456789abcdef123456789abcdef123456789ab
 * @returns `2024-03-01/0x123456789abcdef123456789abcdef123456789ab`
 *
 * @example
 * const docId = createWeekCashbackRewardDocumentId('2024-03-01', '0x123456789abcdef123456789abcdef123456789ab')
 * // '2024-03-01/0x123456789abcdef123456789abcdef123456789ab'
 */
export function createWeekCashbackRewardDocumentId(
  week: WeekIdFormatType,
  address: Address,
): `${WeekIdFormatType}/${Address}` {
  return `${week}/${address.toLowerCase() as Address}`;
}

export type WeekCashbackRewardModelType = Model<WeekCashbackRewardDocumentFieldsType_Unpopulated>;

export function createWeekCashbackRewardModel(mongooseConnection: Mongoose): WeekCashbackRewardModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[modelName]) {
    return mongooseConnection.models[modelName] as WeekCashbackRewardModelType;
  }

  return mongooseConnection.model(modelName, weekCashbackRewardSchema) as WeekCashbackRewardModelType;
}

/**
 * Creates (or returns the week) cashback reward document
 */
export async function createWeekRewardsSnapshotDocument(
  model: WeekCashbackRewardModelType,
  week: WeekIdFormatType,
  address: Address,
  session?: ClientSession,
): Promise<HydratedDocument<WeekCashbackRewardDocumentFieldsType_Unpopulated>> {
  address = address.toLowerCase() as Address;
  const documentId = createWeekCashbackRewardDocumentId(week, address);
  const weekCashbackRewardDocument = await model.findById(documentId, {}, { session });

  if (weekCashbackRewardDocument === null) {
    return new model<WeekCashbackRewardDocumentFieldsType_Unpopulated>({
      _id: documentId,
      safe: address,
      week,
      netUsdVolume: 0,
      maxGnoBalance: 0,
      minGnoBalance: 0,
      estimatedReward: 0,
      transactions: [],
      gnoBalanceSnapshots: [],
      earnedReward: null,
    }).save({ session }) as any;
  }

  return weekCashbackRewardDocument as any;
}
