const { Router } = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const User = require('../models/User');
const AuthLog = require('../models/AuthLog');
const Shipment = require('../models/Shipment');

const router = Router();

router.use(protect, authorize('driver'));

router.get('/profile', async (req, res) => {
  try {
    const driver = await User.findById(req.user._id);
    res.json(driver);
  } catch (error) {
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

router.get('/pickups', async (req, res) => {
  try {
    const shipments = await Shipment.find({
      assignedPickupDriver: req.user._id,
      status: 'pending',
    })
      .populate('customer', 'name email phone address')
      .populate('createdBy', 'name username')
      .sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/deliveries', async (req, res) => {
  try {
    const shipments = await Shipment.find({
      assignedDeliveryDriver: req.user._id,
      status: 'in_transit',
    })
      .populate('customer', 'name email phone address')
      .populate('createdBy', 'name username')
      .sort({ createdAt: -1 });
    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/shipments/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate('customer', 'name email phone address')
      .populate('createdBy', 'name username role')
      .populate('assignedPickupDriver', 'name username phone')
      .populate('assignedDeliveryDriver', 'name username phone')
      .populate('statusHistory.changedBy', 'name username role');
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    const isAssignedPickup = shipment.assignedPickupDriver?._id?.toString() === req.user._id.toString();
    const isAssignedDelivery = shipment.assignedDeliveryDriver?._id?.toString() === req.user._id.toString();
    if (!isAssignedPickup && !isAssignedDelivery) {
      return res.status(403).json({ message: 'Not authorized to view this shipment' });
    }
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.patch('/shipments/:id/pickup', async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'pending') {
      return res.status(400).json({ message: 'Shipment is not in pending status' });
    }
    if (shipment.assignedPickupDriver?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not assigned as pickup driver for this shipment' });
    }

    shipment.status = 'picked';
    shipment.pickedAt = new Date();
    shipment.statusHistory.push({
      status: 'picked',
      changedBy: req.user._id,
      changedAt: new Date(),
      remarks: remarks || 'Package picked up by driver',
    });
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate('customer', 'name email phone address')
      .populate('createdBy', 'name username role')
      .populate('assignedPickupDriver', 'name username phone')
      .populate('assignedDeliveryDriver', 'name username phone')
      .populate('statusHistory.changedBy', 'name username role');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.patch('/shipments/:id/deliver', async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'in_transit') {
      return res.status(400).json({ message: 'Shipment is not in transit' });
    }
    if (shipment.assignedDeliveryDriver?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not assigned as delivery driver for this shipment' });
    }

    shipment.status = 'delivered';
    shipment.deliveredAt = new Date();
    shipment.statusHistory.push({
      status: 'delivered',
      changedBy: req.user._id,
      changedAt: new Date(),
      remarks: remarks || 'Package delivered by driver',
    });
    await shipment.save();

    const populated = await Shipment.findById(shipment._id)
      .populate('customer', 'name email phone address')
      .populate('createdBy', 'name username role')
      .populate('assignedPickupDriver', 'name username phone')
      .populate('assignedDeliveryDriver', 'name username phone')
      .populate('statusHistory.changedBy', 'name username role');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
