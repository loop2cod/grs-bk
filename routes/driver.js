const { Router } = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const User = require('../models/User');
const AuthLog = require('../models/AuthLog');
const Shipment = require('../models/Shipment');

const router = Router();

router.use(protect, authorize('driver'));

const populateShipment = (query) =>
  query
    .populate('customer', 'name email phone address')
    .populate('createdBy', 'name username role')
    .populate('assignedPickupDriver', 'name username phone')
    .populate('assignedDeliveryDriver', 'name username phone')
    .populate('statusHistory.changedBy', 'name username role');

const pushHistory = (shipment, status, req, remarks) => {
  shipment.statusHistory.push({
    status,
    changedBy: req.user._id,
    changedAt: new Date(),
    remarks: remarks || '',
  });
};

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

router.get('/pending-dropoffs', async (req, res) => {
  try {
    const shipments = await Shipment.find({
      assignedPickupDriver: req.user._id,
      status: 'picked',
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

const determineAction = (shipment, driverId) => {
  if (shipment.status === 'pending') {
    if (shipment.assignedPickupDriver && shipment.assignedPickupDriver.toString() !== driverId.toString()) {
      return { allowed: false, message: 'Another driver is already assigned for pickup' };
    }
    return { allowed: true, action: 'pickup', label: 'Pick up from customer', description: 'Pick up the package from the customer address.' };
  }

  if (shipment.status === 'picked') {
    if (shipment.assignedPickupDriver && shipment.assignedPickupDriver.toString() === driverId.toString()) {
      return { allowed: true, action: 'drop_office', label: 'Drop at office', description: 'Mark this package as dropped at the office.' };
    }
    if (!shipment.assignedPickupDriver) {
      return { allowed: true, action: 'office_pickup', label: 'Pick up from office for delivery', description: 'Collect this package from the office and deliver to the customer.' };
    }
    return { allowed: false, message: 'Only the assigned pickup driver can drop this at the office' };
  }

  if (shipment.status === 'in_transit') {
    if (!shipment.assignedDeliveryDriver) {
      return { allowed: true, action: 'assign_delivery', label: 'Assign me for delivery', description: 'You will be assigned as the delivery driver for this package.' };
    }
    if (shipment.assignedDeliveryDriver.toString() === driverId.toString()) {
      return { allowed: true, action: 'delivery', label: 'Deliver to customer', description: 'Mark this package as delivered to the customer.' };
    }
    return { allowed: false, message: 'Another driver is already assigned for delivery' };
  }

  const terminalMessages = {
    delivered: 'This package has already been delivered',
    cancelled: 'This shipment has been cancelled',
  };
  return { allowed: false, message: terminalMessages[shipment.status] || 'Cannot process this shipment' };
};

router.post('/scan', async (req, res) => {
  try {
    const { trackingNumber, confirmed } = req.body;
    if (!trackingNumber) return res.status(400).json({ message: 'Tracking number is required' });

    const shipment = await Shipment.findOne({ trackingNumber: trackingNumber.trim() });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const driverId = req.user._id;
    const decision = determineAction(shipment, driverId);

    if (!decision.allowed) {
      return res.status(403).json({ message: decision.message });
    }

    if (!confirmed) {
      const preview = await populateShipment(Shipment.findById(shipment._id));
      return res.json({ preview: true, action: decision.action, label: decision.label, description: decision.description, shipment: preview });
    }

    if (decision.action === 'pickup') {
      shipment.assignedPickupDriver = driverId;
      shipment.status = 'picked';
      shipment.pickedAt = new Date();
      pushHistory(shipment, 'assigned_pickup_driver', req, 'Auto-assigned via QR scan');
      pushHistory(shipment, 'picked', req, 'Package picked up via QR scan');
    } else if (decision.action === 'drop_office') {
      shipment.status = 'in_transit';
      pushHistory(shipment, 'in_transit', req, 'Package dropped at office via QR scan');
    } else if (decision.action === 'office_pickup') {
      shipment.assignedDeliveryDriver = driverId;
      shipment.status = 'in_transit';
      pushHistory(shipment, 'assigned_delivery_driver', req, 'Auto-assigned via QR scan');
      pushHistory(shipment, 'in_transit', req, 'Package picked up from office for delivery via QR scan');
    } else if (decision.action === 'assign_delivery') {
      shipment.assignedDeliveryDriver = driverId;
      pushHistory(shipment, 'assigned_delivery_driver', req, 'Auto-assigned via QR scan');
    } else if (decision.action === 'delivery') {
      shipment.status = 'delivered';
      shipment.deliveredAt = new Date();
      pushHistory(shipment, 'delivered', req, 'Package delivered via QR scan');
    }

    await shipment.save();
    const populated = await populateShipment(Shipment.findById(shipment._id));
    res.json({ action: decision.action, message: decision.label + ' completed', shipment: populated });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/shipments/:id', async (req, res) => {
  try {
    const shipment = await populateShipment(Shipment.findById(req.params.id));
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

    const populated = await populateShipment(Shipment.findById(shipment._id));
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.patch('/shipments/:id/drop-office', async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'picked') {
      return res.status(400).json({ message: 'Shipment must be picked up first' });
    }
    if (shipment.assignedPickupDriver?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not the pickup driver for this shipment' });
    }

    shipment.status = 'in_transit';
    pushHistory(shipment, 'in_transit', req, remarks || 'Package dropped at office');
    await shipment.save();

    const populated = await populateShipment(Shipment.findById(shipment._id));
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

    const populated = await populateShipment(Shipment.findById(shipment._id));
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
