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
  codType: { type: String, enum: ['pay_first', 'collect_on_delivery'] },
  itemValue: { type: Number, default: 0 },
  deliveryCharge: { type: Number, default: 0 },
  totalCollectible: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  codPaidToCustomer: { type: Boolean, default: false },
  codPaidToCustomerBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  codPaidToCustomerAt: { type: Date },
  codCollectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  codCollectedAt: { type: Date },
  codCollectedAmount: { type: Number, default: null },

  status: {
    type: String,
    enum: ['pending', 'picked', 'in_transit', 'delivered', 'cancelled', 'returned', 'returned_to_sender'],
    default: 'pending',
  },

  pickupType: {
    type: String,
    enum: ['office_dropoff', 'driver_pickup'],
    default: 'office_dropoff',
  },

  assignedPickupDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedDeliveryDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  courierPartner: { type: String, default: null },

  pickedAt: { type: Date },
  deliveredAt: { type: Date },

  notes: { type: String },

  returnToSender: { type: Boolean, default: false },
  returnCharge: { type: Number, default: null },
  returnChargeCollectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  returnChargeCollectedAt: { type: Date },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  statusHistory: [{
    status: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    remarks: { type: String },
  }],
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
shipmentSchema.index({ assignedPickupDriver: 1 });
shipmentSchema.index({ assignedDeliveryDriver: 1 });

module.exports = mongoose.model('Shipment', shipmentSchema);
