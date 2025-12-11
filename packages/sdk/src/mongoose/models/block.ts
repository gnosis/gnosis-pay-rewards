import { IndexOptions, Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { toWeekId } from '../../week-functions.js';
import { mongooseSchemaWeekIdField } from './shared-schema-fields.js';
import { BlockDocumentFieldsType } from '../../database/block-zod.js';

export const blockModelName = 'Block' as const;
export const blockCollectionName = 'blocks' as const;

export const processedBlockModelName = 'ProcessedBlock' as const;
export const processedBlockCollectionName = 'processed_blocks' as const;

const baseBlockSchema = new Schema<BlockDocumentFieldsType>(
  {
    _id: {
      type: Number,
      required: true,
    },
    number: {
      type: Number,
      required: true,
    },
    hash: {
      type: String,
      required: true,
    },
    week: mongooseSchemaWeekIdField,
    timestamp: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
  },
)

  .index({ number: 1 }, { unique: true } as IndexOptions)
  .index({ week: 1 })
  .pre('save', function (this: BlockDocumentFieldsType, next) {
    this._id = this.number;
    this.week = toWeekId(this.timestamp);
    next();
  })
  .plugin(mongoosePaginate);

// Create schema for blocks collection
const blockSchema = baseBlockSchema.clone().set('collection', blockCollectionName);

// Create schema for processed blocks collection
const processedBlockSchema = baseBlockSchema.clone().set('collection', processedBlockCollectionName);

export type BlockModelType = PaginateModel<BlockDocumentFieldsType>;
export type ProcessedBlockModelType = PaginateModel<BlockDocumentFieldsType>;

export function createBlockModel(mongoose: Mongoose): BlockModelType {
  return (mongoose.models[blockModelName] ?? mongoose.model(blockModelName, blockSchema)) as unknown as BlockModelType;
}

/**
 * Create a model for the ProcessBlock collection.
 */
export function createProcessedBlockModel(mongoose: Mongoose): ProcessedBlockModelType {
  return (mongoose.models[processedBlockModelName] ??
    mongoose.model(processedBlockModelName, processedBlockSchema)) as unknown as ProcessedBlockModelType;
}
