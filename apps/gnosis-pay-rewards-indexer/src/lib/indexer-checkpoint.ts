import { Model, Mongoose, Schema } from 'mongoose';
import { z } from 'zod';

const indexerCheckpointZodSchema = z.object({
  _id: z.string(),
  lastProcessedBlock: z.coerce.number().positive(),
  updatedAt: z.date(),
});

export type IndexerCheckpointDocumentType = z.infer<typeof indexerCheckpointZodSchema>;

const indexerCheckpointSchema = new Schema<IndexerCheckpointDocumentType>(
  {
    _id: {
      type: String,
      required: true,
    },
    lastProcessedBlock: {
      type: Number,
      required: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
    timestamps: true,
  },
).pre('save', function (this: IndexerCheckpointDocumentType, next) {
  const parsed = indexerCheckpointZodSchema.safeParse(this);
  if (!parsed.success) {
    throw new Error('Invalid indexer checkpoint document', { cause: parsed.error });
  }

  this._id = parsed.data._id;
  this.lastProcessedBlock = parsed.data.lastProcessedBlock;
  this.updatedAt = parsed.data.updatedAt;

  next();
});

export type IndexerCheckpointModelType = Model<IndexerCheckpointDocumentType>;

const collectionName = 'indexer_checkpoints';

export function createIndexerCheckpointModel(
  mongooseConnection: Mongoose,
): IndexerCheckpointModelType {
  // Return cached model if it exists
  return (
    mongooseConnection.models[collectionName] ??
      mongooseConnection.model<IndexerCheckpointDocumentType>(
        collectionName,
        indexerCheckpointSchema,
        collectionName,
      )
  );
}

/**
 * Save the checkpoint for an indexer
 */
export async function saveIndexerCheckpoint(
  model: IndexerCheckpointModelType,
  indexerId: string,
  lastProcessedBlock: number,
): Promise<void> {
  if (typeof indexerId !== 'string' || indexerId === '') {
    throw new Error('Indexer ID is required');
  }

  if (typeof lastProcessedBlock !== 'number' || isNaN(lastProcessedBlock)) {
    throw new Error('Last processed block is required');
  }

  if (lastProcessedBlock < 0) {
    throw new Error('Last processed block must be greater than 0');
  }

  await model.findOneAndUpdate(
    { _id: indexerId },
    {
      _id: indexerId,
      lastProcessedBlock,
      updatedAt: new Date(),
    },
    { upsert: true },
  );
}

/**
 * Load the checkpoint for an indexer
 * @returns The last processed block number, or null if no checkpoint exists
 */
export async function loadIndexerCheckpoint(
  model: IndexerCheckpointModelType,
  indexerId: string,
): Promise<number | null> {
  const checkpoint = await model.findById(indexerId).lean();
  return checkpoint?.lastProcessedBlock ?? null;
}
