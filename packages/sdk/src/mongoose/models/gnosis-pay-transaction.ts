import { Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { isHash } from 'viem';
import { mongooseSchemaAddressField, mongooseSchemaWeekIdField } from './shared-schema-fields.js';
import { GnosisPayTransactionFieldsType, GnosisPayTransactionType } from '../../database/gnosis-pay-transaction-zod.js';
import { blockModelName } from './block.js';
import { tokenModelName } from './token.js';
import {
  gnosisPaySafeModelName,
  gnosisPayTransactionCollectionName as collectionName,
  gnosisPayTransactionModelName as modelName,
} from './model-config.js';

export const gnosisPayTransactionSchema = new Schema<GnosisPayTransactionFieldsType>(
  {
    _id: {
      type: String,
      required: true,
      validate: {
        validator: (value: string) => isHash(value),
        message: '{VALUE} is not a valid hash',
      },
    },
    type: {
      type: String,
      enum: Object.values(GnosisPayTransactionType),
      required: true,
    },
    block: {
      type: Number,
      required: true,
      ref: blockModelName,
    },
    week: mongooseSchemaWeekIdField,
    transactionHash: {
      type: String,
      required: true,
    },
    amountRaw: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    valueUSD: {
      type: Number,
      required: true,
    },
    token: {
      type: String,
      ref: tokenModelName,
      required: true,
    },
    safe: {
      ...mongooseSchemaAddressField,
      ref: gnosisPaySafeModelName,
      required: true,
    },
  },
  {
    _id: false,
    collection: collectionName,
  },
)
  // Critical indexes for performance
  .index({ safe: 1, block: -1 })
  .index({ block: -1 })
  .index({ week: 1 })
  .plugin(mongoosePaginate);

export type GnosisPayTransactionModelType = PaginateModel<GnosisPayTransactionFieldsType>;

export function createGnosisPayTransactionModel(mongoose: Mongoose): GnosisPayTransactionModelType {
  return (mongoose.models[modelName] ??
    mongoose.model(modelName, gnosisPayTransactionSchema)) as unknown as GnosisPayTransactionModelType;
}
