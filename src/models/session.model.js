import mongoose, { Schema } from 'mongoose';

const sessionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    text: {
      type: String,
      default: '',
    },
    typedText: {
      type: String,
      default: '',
    },
    gameMode: {
      type: String,
      enum: ['phrases', 'words'],
      default: 'phrases',
    },
    wordCount: {
      type: Number,
      default: 50,
    },
    punctuationEnabled: {
      type: Boolean,
      default: false,
    },
    numbersEnabled: {
      type: Boolean,
      default: false,
    },
    timeMax: {
      type: Number,
      default: 120,
    },
    totalWords: {
      type: Number,
      default: 0,
    },
    incomplete: {
      type: Boolean,
      default: true,
      index: true,
    },
    resultsId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Result',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Session = mongoose.model('Session', sessionSchema);

export default Session;
