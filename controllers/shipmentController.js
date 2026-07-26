const Shipment = require('../models/Shipment');
const PricingSetting = require('../models/PricingSetting');

const calculatePrice = (weight, pricing) => {
  if (!pricing || !pricing.tiers) return 0;
  const sorted = [...pricing.tiers].sort((a, b) => a.minWeight - b.minWeight);
  const found = sorted.find(t => {
    const minOk = t.minWeight === undefined || t.minWeight === null || weight >= t.minWeight;
    const maxOk = t.maxWeight === undefined || t.maxWeight === null || weight <= t.maxWeight;
    return minOk && maxOk;
  });
  if (!found) return 0;
  if (found.type === 'fixed') return found.price;
  const maxFixed = sorted
    .filter(t => t.type === 'fixed' && t.price != null)
    .reduce((max, t) => Math.max(max, t.price), 0);
  return maxFixed + found.price * Math.max(0, weight - found.minWeight);
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
  { path: 'codCollectedBy', select: 'name username' },
  { path: 'codPaidToCustomerBy', select: 'name username' },
];

const listShipments = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const status = req.query.status;
    const search = req.query.search;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    const skip = (page - 1) * limit;

    const pipeline = [];

    const userProjection = { name: 1, email: 1, phone: 1, username: 1, address: 1, role: 1 };

    for (const { as, localField } of [
      { as: 'customer', localField: 'customer' },
      { as: 'createdBy', localField: 'createdBy' },
      { as: 'assignedPickupDriver', localField: 'assignedPickupDriver' },
      { as: 'assignedDeliveryDriver', localField: 'assignedDeliveryDriver' },
    ]) {
      pipeline.push({
        $lookup: {
          from: 'users',
          localField,
          foreignField: '_id',
          as,
          pipeline: [{ $project: userProjection }],
        },
      });
      pipeline.push({ $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } });
    }

    pipeline.push({
      $addFields: {
        sortPriority: {
          $switch: {
            branches: [
              { case: { $in: ['$status', ['pending', 'picked', 'in_transit']] }, then: 0 },
              { case: { $eq: ['$status', 'delivered'] }, then: 1 },
              { case: { $in: ['$status', ['returned', 'returned_to_sender']] }, then: 2 },
              { case: { $eq: ['$status', 'cancelled'] }, then: 3 },
            ],
            default: 3,
          },
        },
      },
    });

    const matchStage = {};
    if (status) matchStage.status = status;
    if (search) {
      matchStage.$or = [
        { trackingNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
      ];
    }
    if (dateFrom || dateTo) {
      matchStage.createdAt = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        matchStage.createdAt.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = to;
      }
    }
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push({ $sort: { sortPriority: 1, createdAt: -1 } });

    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    });

    const result = await Shipment.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const shipments = (result[0]?.data || []).map(s => { delete s.sortPriority; return s });

    res.json({
      shipments,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
    });
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
      itemValue, codType,
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
    const itemVal = itemValue || 0;
    const deliveryChg = finalAmount;
    const isCod = paymentMethod === 'cod';
    const codTypeVal = isCod ? (codType || 'collect_on_delivery') : undefined;
    const totalCollectible = isCod ? itemVal + deliveryChg : 0;

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
      codType: codTypeVal,
      itemValue: itemVal,
      deliveryCharge: deliveryChg,
      totalCollectible,
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

    // For office drop-off pay-first, office handles the payment to customer
    if (isOfficeDropoff && codTypeVal === 'pay_first') {
      shipmentData.codPaidToCustomer = true;
      shipmentData.codPaidToCustomerBy = req.user._id;
      shipmentData.codPaidToCustomerAt = new Date();
    }

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
    if (shipment.paymentMethod === 'cod' && shipment.codType === 'pay_first') {
      shipment.codPaidToCustomer = true;
      shipment.codPaidToCustomerBy = req.user._id;
      shipment.codPaidToCustomerAt = new Date();
    }
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
    if (!['picked', 'pending', 'returned'].includes(shipment.status)) {
      return res.status(400).json({ message: 'Shipment must be picked, pending, or returned to mark in transit' });
    }

    shipment.status = 'in_transit';
    if (shipment.status === 'returned') {
      shipment.assignedDeliveryDriver = null;
    }
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
    const { remarks, collectedAmount } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'in_transit') {
      return res.status(400).json({ message: 'Shipment must be in transit to mark delivered' });
    }

    shipment.status = 'delivered';
    shipment.deliveredAt = new Date();
    pushHistory(shipment, 'delivered', req, remarks || 'Package delivered successfully');
    if (shipment.paymentMethod === 'cod' && shipment.totalCollectible > 0) {
      shipment.codCollectedBy = req.user._id;
      shipment.codCollectedAt = new Date();
      shipment.codCollectedAmount = collectedAmount || shipment.totalCollectible;
    }
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

const markCancelledAsDropped = async (req, res) => {
  try {
    const { returnCharge, remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'cancelled') {
      return res.status(400).json({ message: 'Shipment must be cancelled' });
    }

    shipment.assignedDeliveryDriver = null;
    shipment.returnToSender = true;
    shipment.status = 'picked';
    if (returnCharge != null) {
      shipment.returnCharge = returnCharge;
    }
    pushHistory(shipment, 'picked', req, remarks || 'Cancelled package dropped at office by admin');
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
  markDelivered, cancelShipment, markCancelledAsDropped,
};
