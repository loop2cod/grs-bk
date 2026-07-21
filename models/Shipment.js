const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trackingNumber: { type: String, unique: true },

  pickupAddress: { type: String },
  useDifferentPickup: { type: Boolean, default: false },
  alternatePickupAddress: { type: String },

  deliveryAddress: { type: String, required: true },
  deliveryContactName: { type: String, required: true },
  deliveryContactPhone: { type: String, required: true },

  items: [{
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    weight: { type: Number, required: true, min: 0 },
  }],
  totalWeight: { type: Number, required: true },
  totalQuantity: { type: Number, required: true },

  pricingTier: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingSetting' },
  pricingSnapshot: { type: mongoose.Schema.Types.Mixed },
  baseAmount: { type: Number, required: true },
  customAmount: { type: Number },
  finalAmount: { type: Number, required: true },

  paymentMethod: { type: String, enum: ['cod', 'paid', 'partial'], required: true },
  paidAmount: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['pending', 'in_transit', 'delivered', 'cancelled'],
    default: 'pending',
  },
  notes: { type: String },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

shipmentSchema.pre('save', async function (next) {
  if (!this.trackingNumber) {
    const now = new Date();
    const uaeOffset = 4 * 60 * 60 * 1000;
    const uaeNow = new Date(now.getTime() + uaeOffset);
    const day = String(uaeNow.getUTCDate()).padStart(2, '0');
    const month = String(uaeNow.getUTCMonth() + 1).padStart(2, '0');
    const year = uaeNow.getUTCFullYear();

    const dayStart = new Date(Date.UTC(uaeNow.getUTCFullYear(), uaeNow.getUTCMonth(), uaeNow.getUTCDate()) - uaeOffset);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const count = await mongoose.model('Shipment').countDocuments({
      createdAt: { $gte: dayStart, $lt: dayEnd },
    });

    const seq = String(count + 1).padStart(3, '0');
    this.trackingNumber = `GRS-${day}${month}${year}-${seq}`;
  }
  next();
});

shipmentSchema.index({ customer: 1 });
shipmentSchema.index({ status: 1 });

module.exports = mongoose.model('Shipment', shipmentSchema);
