import { Schema, Mongoose, PaginateModel } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { mongooseSchemaAddressField } from './sharedSchemaFields';
import { gnosisPayTokenModelName } from './gnosisPayToken';
import { GnosisPayTokenPriceDocumentFieldsType } from '../database/gnosis-pay-token-price';

export const gnosisPayTokenPriceModelName = 'TokenPrice' as const;

const gnosisPayTokenPriceSchema = new Schema<GnosisPayTokenPriceDocumentFieldsType>(
  {
    _id: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    blockNumber: {
      type: Number,
      required: true,
    },
    blockTimestamp: {
      type: Number,
      required: true,
    },
    blockTimestampIso: {
      type: Date,
      required: true,
    },
    token: {
      ...mongooseSchemaAddressField,
      ref: gnosisPayTokenModelName,
      required: true,
    },
  },
  {
    _id: false, // Disable auto _id since we're providing our own
    timestamps: true,
  },
)
  .index({ token: 1, blockNumber: -1 })
  .index({ blockTimestamp: 1 })
  .index({ blockTimestamp: 1, token: 1 }) // For date range queries with token filter
  .plugin(mongoosePaginate);

export type GnosisPayTokenPriceModelType = PaginateModel<GnosisPayTokenPriceDocumentFieldsType>;

export function createGnosisPayTokenPriceModel(mongooseConnection: Mongoose): GnosisPayTokenPriceModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[gnosisPayTokenPriceModelName]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mongooseConnection.models[gnosisPayTokenPriceModelName] as any;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mongooseConnection.model(gnosisPayTokenPriceModelName, gnosisPayTokenPriceSchema) as any;
}

/**
 * Helper function to generate the _id for a token price document
 */
export function createGnosisPayTokenPriceDocumentId(blockNumber: number, tokenAddress: string): string {
  return `${blockNumber}/${tokenAddress.toLowerCase()}`;
}
