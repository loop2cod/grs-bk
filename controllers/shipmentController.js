const Shipment = require('../models/Shipment');
const PricingSetting = require('../models/PricingSetting');

const calculatePrice = (weight, pricing) => {
  if (!pricing || !pricing.tiers) return 0;
  const tier = pricing.tiers.find(t => {
    if (t.maxWeight === undefined) return weight >= t.minWeight;
    return weight >= t.minWeight && weight <= t.maxWeight;
  });
  if (!tier) return 0;
  if (tier.type === 'fixed') return tier.price;
  return tier.price * weight;
};

const listShipments = async (req, res) => {
  try {
    const shipments = await Shipment.find()
      .populate('customer', 'name email phone username address')
      .populate('createdBy', 'name username')
      .sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getShipment = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate('customer', 'name email phone username address')
      .populate('createdBy', 'name username');
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const createShipment = async (req, res) => {
  try {
    const {
      customer, pickupAddress, useDifferentPickup, alternatePickupAddress,
      deliveryAddress, deliveryContactName, deliveryContactPhone,
      items, pricingTier, customAmount, paymentMethod, paidAmount,
      notes, deliverySameAsPickup,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required' });
    }

    const totalWeight = items.reduce((sum, i) => sum + (i.weight * i.quantity), 0);
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);

    let pricing = null;
    if (pricingTier) {
      pricing = await PricingSetting.findById(pricingTier);
    }
    if (!pricing) {
      pricing = await PricingSetting.findOne({ isDefault: true });
    }

    const baseAmount = pricing ? calculatePrice(totalWeight, pricing) : 0;
    const finalAmount = customAmount !== undefined && customAmount !== null ? customAmount : baseAmount;

    const shipmentData = {
      customer,
      pickupAddress: useDifferentPickup ? alternatePickupAddress : pickupAddress,
      useDifferentPickup,
      alternatePickupAddress: useDifferentPickup ? alternatePickupAddress : undefined,
      deliveryAddress,
      deliveryContactName,
      deliveryContactPhone,
      items,
      totalWeight,
      totalQuantity,
      pricingTier: pricing?._id,
      pricingSnapshot: pricing ? { name: pricing.name, tiers: pricing.tiers } : null,
      baseAmount,
      customAmount: customAmount !== undefined && customAmount !== null ? customAmount : undefined,
      finalAmount,
      paymentMethod,
      paidAmount: paymentMethod === 'paid' ? finalAmount : (paymentMethod === 'partial' ? (paidAmount || 0) : 0),
      notes,
      status: 'pending',
      createdBy: req.user._id,
    };

    const shipment = await Shipment.create(shipmentData);
    const populated = await Shipment.findById(shipment._id)
      .populate('customer', 'name email phone username address')
      .populate('createdBy', 'name username');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateShipmentStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const shipment = await Shipment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { listShipments, getShipment, createShipment, updateShipmentStatus };
