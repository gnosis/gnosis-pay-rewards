import { Mongoose, Schema, ClientSession, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { Address, isAddress } from 'viem';

import { GnosisTokenBalanceSnapshotDocumentType } from '../database/gnosisTokenBalanceSnapshot';
import { mongooseSchemaAddressField, mongooseSchemaWeekIdField } from './sharedSchemaFields';

export const gnosisTokenBalanceSnapshotModelName = 'GnosisTokenBalanceSnapshot' as const;

export const gnosisTokenBalanceSnapshotSchema = new Schema<GnosisTokenBalanceSnapshotDocumentType>(
  {
    _id: {
      type: String,
      required: true,
      validate: {
        validator: (v: string) => {
          const [blockNumber, safeAddress] = v.split('/');

          return isAddress(safeAddress) && !isNaN(Number(blockNumber));
        },
        message:
          'Invalid Gnosis Token Balance Snapshot document id: {VALUE}. Expected format: <blockNumber>/<safeAddress>',
      },
    },
    weekId: mongooseSchemaWeekIdField,
    safe: {
      ...mongooseSchemaAddressField,
      ref: 'GnosisPaySafeAddress',
      required: true,
    },
    balanceRaw: { type: String, required: true },
    balance: { type: Number, required: true },
    blockNumber: { type: Number, required: true },
    blockTimestamp: { type: Number, required: true },
  },
  {
    _id: false,
  },
)
  // composite index
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  .index({ safe: 1, blockNumber: 1 }, { unique: true })
  // Additional indexes for performance
  .index({ weekId: 1 }) // For queries by week
  .index({ safe: 1, weekId: 1 }) // For queries by safe and week
  .index({ blockTimestamp: -1 }) // For time-based queries
  .index({ safe: 1, blockTimestamp: -1 }) // For safe-specific time queries
  .pre('save', function (next) {
    this.safe = this.safe.toLowerCase() as Address;
    next();
  })
  .plugin(mongoosePaginate);

export type GnosisTokenBalanceSnapshotModelType = PaginateModel<GnosisTokenBalanceSnapshotDocumentType>;

/**
 * Creates a new Gnosis Token Balance Snapshot document id
 * @param blockNumber the block number
 * @param safeAddress the safe address
 * @returns
 */
export function createGnosisTokenBalanceSnapshotDocumentId(blockNumber: number, safeAddress: Address) {
  return `${blockNumber}/${safeAddress.toLowerCase()}` as `${number}/${Address}`;
}

export function createGnosisTokenBalanceSnapshotModel(
  mongooseConnection: Mongoose,
): GnosisTokenBalanceSnapshotModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[gnosisTokenBalanceSnapshotModelName]) {
    return mongooseConnection.models[
      gnosisTokenBalanceSnapshotModelName
    ] as unknown as GnosisTokenBalanceSnapshotModelType;
  }

  return mongooseConnection.model(
    gnosisTokenBalanceSnapshotModelName,
    gnosisTokenBalanceSnapshotSchema,
  ) as GnosisTokenBalanceSnapshotModelType;
}

/**
 * Creates a new Gnosis Token Balance Snapshot document for a safe
 * @param gnosisTokenBalanceSnapshotModel
 * @param payload
 * @param session
 * @returns
 */
export function createGnosisTokenBalanceSnapshotDocument(
  gnosisTokenBalanceSnapshotModel: GnosisTokenBalanceSnapshotModelType,
  payload: Omit<GnosisTokenBalanceSnapshotDocumentType, '_id'>,
  session?: ClientSession,
) {
  const _id = createGnosisTokenBalanceSnapshotDocumentId(payload.blockNumber, payload.safe);

  return new gnosisTokenBalanceSnapshotModel<GnosisTokenBalanceSnapshotDocumentType>({
    _id,
    ...payload,
  }).save({
    session,
  });
}
