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

const pushHistory = (shipment, status, req, remarks) => {
  shipment.statusHistory.push({
    status,
    changedBy: req.user._id,
    changedAt: new Date(),
    remarks: remarks || '',
  });
};

const basePopulate = [
  { path: 'customer', select: 'name email phone username address' },
  { path: 'createdBy', select: 'name username role' },
  { path: 'assignedPickupDriver', select: 'name username phone' },
  { path: 'assignedDeliveryDriver', select: 'name username phone' },
];

const listShipments = async (req, res) => {
  try {
    const shipments = await Shipment.find()
      .populate(basePopulate)
      .sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getShipment = async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
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
      notes, pickupType, assignedPickupDriver,
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

    const pt = pickupType || 'office_dropoff';
    const isOfficeDropoff = pt === 'office_dropoff';

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
      pickupType: pt,
      assignedPickupDriver: assignedPickupDriver || null,
      status: isOfficeDropoff ? 'picked' : 'pending',
      pickedAt: isOfficeDropoff ? new Date() : null,
      createdBy: req.user._id,
      statusHistory: [{
        status: isOfficeDropoff ? 'picked' : 'pending',
        changedBy: req.user._id,
        changedAt: new Date(),
        remarks: isOfficeDropoff ? 'Office drop-off — auto marked as picked' : 'Shipment created',
      }],
    };

    const shipment = await Shipment.create(shipmentData);
    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const assignPickupDriver = async (req, res) => {
  try {
    const { driverId, remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (!['pending'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Can only assign pickup driver when status is pending' });
    }

    const prevDriver = shipment.assignedPickupDriver;
    shipment.assignedPickupDriver = driverId;
    pushHistory(shipment, 'assigned_pickup_driver', req,
      prevDriver ? `Reassigned pickup driver` + (remarks ? `: ${remarks}` : '') : (remarks || 'Pickup driver assigned'));
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const assignDeliveryDriver = async (req, res) => {
  try {
    const { driverId, remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (!['picked', 'in_transit'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Can only assign delivery driver when status is picked or in_transit' });
    }

    const prevDriver = shipment.assignedDeliveryDriver;
    shipment.assignedDeliveryDriver = driverId;
    pushHistory(shipment, 'assigned_delivery_driver', req,
      prevDriver ? `Reassigned delivery driver` + (remarks ? `: ${remarks}` : '') : (remarks || 'Delivery driver assigned'));
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const markAsPicked = async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (!['pending'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Shipment is not in pending status' });
    }

    shipment.status = 'picked';
    shipment.pickedAt = new Date();
    pushHistory(shipment, 'picked', req, remarks || 'Package picked up');
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const markAsInTransit = async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (!['picked', 'pending'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Shipment must be picked or pending to mark in transit' });
    }

    shipment.status = 'in_transit';
    if (!shipment.pickedAt) shipment.pickedAt = new Date();
    pushHistory(shipment, 'in_transit', req, remarks || 'Shipment in transit');
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const handoverToCourier = async (req, res) => {
  try {
    const { partnerName, remarks } = req.body;
    if (!partnerName) return res.status(400).json({ message: 'Courier partner name is required' });
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (!['picked'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Shipment must be picked to handover to courier' });
    }

    shipment.courierPartner = partnerName;
    shipment.status = 'in_transit';
    pushHistory(shipment, 'handover_courier', req, remarks || `Handed over to ${partnerName}`);
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const markDelivered = async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'in_transit') {
      return res.status(400).json({ message: 'Shipment must be in transit to mark delivered' });
    }

    shipment.status = 'delivered';
    shipment.deliveredAt = new Date();
    pushHistory(shipment, 'delivered', req, remarks || 'Package delivered successfully');
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const cancelShipment = async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (['delivered', 'cancelled'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Cannot cancel a delivered or already cancelled shipment' });
    }

    shipment.status = 'cancelled';
    pushHistory(shipment, 'cancelled', req, remarks || 'Shipment cancelled');
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate([...basePopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  listShipments, getShipment, createShipment,
  assignPickupDriver, assignDeliveryDriver,
  markAsPicked, markAsInTransit, handoverToCourier,
  markDelivered, cancelShipment,
};
