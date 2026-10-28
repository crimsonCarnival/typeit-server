import mongoose, { Schema } from 'mongoose';

// A player's custom practice word list (code keywords, names, other
// languages...). Limits live in config/learn.js and are enforced on write.
const wordListSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    words: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false }
);

const WordList = mongoose.model('WordList', wordListSchema);

export default WordList;
