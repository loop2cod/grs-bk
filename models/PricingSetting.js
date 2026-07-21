const mongoose = require('mongoose');

const tierSchema = new mongoose.Schema({
  minWeight: { type: Number, required: true, min: 0 },
  maxWeight: { type: Number, min: 0 },
  type: { type: String, enum: ['fixed', 'per_kg'], required: true },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const pricingSettingSchema = new mongoose.Schema({
  name: { type: String, required: true },
  tiers: { type: [tierSchema], required: true, validate: [t => t.length > 0, 'At least one tier required'] },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('PricingSetting', pricingSettingSchema);
