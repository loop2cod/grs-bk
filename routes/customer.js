const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const User = require('../models/User');
const AuthLog = require('../models/AuthLog');
const Shipment = require('../models/Shipment');
const PricingSetting = require('../models/PricingSetting');
const { generateLabel } = require('../services/labelService');

const router = Router();

router.use(protect, authorize('customer'));

router.get('/profile', async (req, res) => {
  try {
    const customer = await User.findById(req.user._id).populate('defaultPricing', 'name');
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const customer = await User.findByIdAndUpdate(
      req.user._id,
      { name, email, phone, address },
      { new: true, runValidators: true }
    );
    res.json(customer);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/auth-logs', async (req, res) => {
  try {
    const logs = await AuthLog.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

const shipmentPopulate = [
  { path: 'createdBy', select: 'name username' },
  { path: 'assignedPickupDriver', select: 'name username phone' },
  { path: 'assignedDeliveryDriver', select: 'name username phone' },
];

router.get('/shipments', async (req, res) => {
  try {
    const shipments = await Shipment.find({ customer: req.user._id })
      .populate(shipmentPopulate)
      .sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/shipments/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ _id: req.params.id, customer: req.user._id })
      .populate([...shipmentPopulate, { path: 'statusHistory.changedBy', select: 'name username role' }]);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/shipments/:id/label', async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ _id: req.params.id, customer: req.user._id })
      .populate('customer', 'name')
      .populate('createdBy', 'name role');
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    const pdf = await generateLabel(shipment);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="label-${shipment.trackingNumber}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate label', error: error.message });
  }
});

router.post('/shipments', [
  body('deliveryAddress').notEmpty().withMessage('Delivery address is required'),
  body('deliveryContactName').notEmpty().withMessage('Delivery contact name is required'),
  body('deliveryContactPhone').notEmpty().withMessage('Delivery contact phone is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('paymentMethod').isIn(['cod', 'paid', 'partial']).withMessage('Invalid payment method'),
  validate,
], async (req, res) => {
  try {
    const {
      pickupAddress, useDifferentPickup, alternatePickupAddress,
      deliveryAddress, deliveryContactName, deliveryContactPhone,
      items, pricingTier, customAmount, paymentMethod, paidAmount,
      notes, itemValue, codType,
    } = req.body;

    const totalWeight = items.reduce((sum, i) => sum + (i.weight * i.quantity), 0);
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);

    let pricing = null;
    if (pricingTier) {
      pricing = await PricingSetting.findById(pricingTier);
    }
    if (!pricing) {
      const customer = await User.findById(req.user._id).select('defaultPricing');
      if (customer?.defaultPricing) {
        pricing = await PricingSetting.findById(customer.defaultPricing);
      }
    }
    if (!pricing) {
      pricing = await PricingSetting.findOne({ isDefault: true });
    }

    const calculatePrice = (weight, p) => {
      if (!p || !p.tiers) return 0;
      const sorted = [...p.tiers].sort((a, b) => a.minWeight - b.minWeight);
      const tier = sorted.find(t => {
        const minOk = t.minWeight === undefined || t.minWeight === null || weight >= t.minWeight;
        const maxOk = t.maxWeight === undefined || t.maxWeight === null || weight <= t.maxWeight;
        return minOk && maxOk;
      });
      if (!tier) return 0;
      if (tier.type === 'fixed') return tier.price;
      const maxFixed = sorted
        .filter(t => t.type === 'fixed' && t.price != null)
        .reduce((max, t) => Math.max(max, t.price), 0);
      return maxFixed + tier.price * Math.max(0, weight - tier.minWeight);
    };

    const baseAmount = pricing ? calculatePrice(totalWeight, pricing) : 0;
    const finalAmount = customAmount !== undefined && customAmount !== null ? customAmount : baseAmount;
    const itemVal = itemValue || 0;
    const deliveryChg = finalAmount;
    const isCod = paymentMethod === 'cod';
    const codTypeVal = isCod ? (codType || 'collect_on_delivery') : undefined;
    const totalCollectible = (isCod || paymentMethod === 'partial') ? itemVal + deliveryChg : 0;

    const shipmentData = {
      customer: req.user._id,
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
      pickupType: 'driver_pickup',
      status: 'pending',
      createdBy: req.user._id,
      statusHistory: [{
        status: 'pending',
        changedBy: req.user._id,
        changedAt: new Date(),
        remarks: 'Shipment created by customer',
      }],
    };

    const shipment = await Shipment.create(shipmentData);
    const populated = await Shipment.findById(shipment._id)
      .populate(shipmentPopulate);

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
