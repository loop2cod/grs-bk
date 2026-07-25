const mongoose = require('mongoose');

const settlementRecordSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  codCollectedTotal: { type: Number, default: 0 },
  codDeliveryCount: { type: Number, default: 0 },
  payFirstTotal: { type: Number, default: 0 },
  payFirstCount: { type: Number, default: 0 },
  returnChargeTotal: { type: Number, default: 0 },
  returnChargeCount: { type: Number, default: 0 },
  totalAccountability: { type: Number, default: 0 },
  status: { type: String, enum: ['submitted', 'confirmed'], default: 'submitted' },
  submittedAt: { type: Date, default: Date.now },
  confirmedAt: { type: Date },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

settlementRecordSchema.index({ driver: 1, date: 1 }, { unique: true });
settlementRecordSchema.index({ date: 1 });

module.exports = mongoose.model('SettlementRecord', settlementRecordSchema);
