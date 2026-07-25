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
    .populate('codCollectedBy', 'name username')
    .populate('codPaidToCustomerBy', 'name username')
    .populate('returnChargeCollectedBy', 'name username')
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
    if (shipment.returnToSender) {
      return { allowed: true, action: 'pickup_return_to_sender', label: 'Pick up for return to sender', description: 'Pick up this cancelled package from the office to return it to the original customer.' };
    }
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
      if (shipment.returnToSender) {
        return {
          allowed: true,
          action: 'return_to_sender',
          label: 'Return package to sender',
          description: 'Deliver this package back to the original sender (customer).',
          altActions: [],
        };
      }
      return {
        allowed: true,
        action: 'delivery',
        label: 'Deliver to customer',
        description: 'Mark this package as delivered to the customer.',
        altActions: [{
          action: 'return_to_office',
          label: 'Return to office',
          description: 'Return this package to the office (e.g., customer not available, wrong address).',
        }, {
          action: 'cancel',
          label: 'Cancel shipment',
          description: 'Cancel this shipment entirely.',
        }],
      };
    }
    return { allowed: false, message: 'Another driver is already assigned for delivery' };
  }

  if (shipment.status === 'returned') {
    if (shipment.assignedDeliveryDriver?.toString() === driverId.toString()) {
      return {
        allowed: true,
        action: 'drop_office_returned',
        label: 'Drop returned package at office',
        description: 'Mark this returned package as dropped at the office, so another driver can re-deliver it.',
        altActions: [],
      };
    }
    if (!shipment.assignedDeliveryDriver) {
      return { allowed: true, action: 'office_pickup', label: 'Pick up from office for delivery', description: 'Collect this package from the office and deliver to the customer.' };
    }
    return { allowed: false, message: 'Only the delivery driver can drop this returned package at the office' };
  }

  if (shipment.status === 'cancelled') {
    return {
      allowed: true,
      action: 'drop_cancelled_at_office',
      label: 'Drop cancelled package at office',
      description: 'Drop this cancelled package at the office, so it can be returned to the original customer.',
      altActions: [],
    };
  }

  const terminalMessages = {
    delivered: 'This package has already been delivered',
  };
  return { allowed: false, message: terminalMessages[shipment.status] || 'Cannot process this shipment' };
};

router.post('/scan', async (req, res) => {
  try {
    const { trackingNumber, confirmed, action: reqAction } = req.body;
    if (!trackingNumber) return res.status(400).json({ message: 'Tracking number is required' });

    const shipment = await Shipment.findOne({ trackingNumber: trackingNumber.trim() });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });

    const driverId = req.user._id;
    const decision = determineAction(shipment, driverId);

    if (!decision.allowed) {
      return res.status(403).json({ message: decision.message });
    }

    const selectedAction = reqAction || decision.action;

    const altActionsList = decision.altActions || [];
    const allActions = [decision, ...altActionsList];
    const selected = allActions.find(a => a.action === selectedAction);

    if (!selected) {
      return res.status(400).json({ message: 'Invalid action for this shipment' });
    }

    if (!confirmed) {
      const preview = await populateShipment(Shipment.findById(shipment._id));
      return res.json({
        preview: true,
        action: decision.action,
        label: decision.label,
        description: decision.description,
        altActions: decision.altActions || [],
        shipment: preview,
      });
    }

    if (selectedAction === 'cancel') {
      shipment.status = 'cancelled';
      pushHistory(shipment, 'cancelled', req, req.body.remarks || 'Shipment cancelled via QR scan');
    } else if (selectedAction === 'return_to_office') {
      shipment.status = 'returned';
      pushHistory(shipment, 'returned', req, req.body.remarks || 'Package returned to office via QR scan');
    } else if (selectedAction === 'drop_office_returned') {
      shipment.assignedDeliveryDriver = null;
      shipment.status = 'in_transit';
      pushHistory(shipment, 'in_transit', req, 'Returned package dropped at office via QR scan');
    } else if (selectedAction === 'drop_cancelled_at_office') {
      shipment.assignedDeliveryDriver = null;
      shipment.returnToSender = true;
      shipment.status = 'picked';
      if (req.body.returnCharge != null) {
        shipment.returnCharge = req.body.returnCharge;
      }
      pushHistory(shipment, 'picked', req, 'Cancelled package dropped at office via QR scan');
    } else if (selectedAction === 'pickup_return_to_sender') {
      shipment.assignedDeliveryDriver = driverId;
      shipment.returnToSender = true;
      shipment.status = 'in_transit';
      pushHistory(shipment, 'assigned_delivery_driver', req, 'Auto-assigned for return to sender via QR scan');
      pushHistory(shipment, 'in_transit', req, 'Package picked up from office for return to sender via QR scan');
    } else if (selectedAction === 'return_to_sender') {
      shipment.status = 'returned_to_sender';
      shipment.deliveredAt = new Date();
      if (shipment.returnCharge > 0) {
        shipment.returnChargeCollectedBy = req.user._id;
        shipment.returnChargeCollectedAt = new Date();
      }
      pushHistory(shipment, 'returned_to_sender', req, 'Package returned to sender via QR scan');
    } else if (selectedAction === 'pickup') {
      shipment.assignedPickupDriver = driverId;
      shipment.status = 'picked';
      shipment.pickedAt = new Date();
      pushHistory(shipment, 'assigned_pickup_driver', req, 'Auto-assigned via QR scan');
      pushHistory(shipment, 'picked', req, 'Package picked up via QR scan');
      if (shipment.paymentMethod === 'cod' && shipment.codType === 'pay_first') {
        shipment.codPaidToCustomer = true;
        shipment.codPaidToCustomerBy = req.user._id;
        shipment.codPaidToCustomerAt = new Date();
      }
    } else if (selectedAction === 'drop_office') {
      shipment.status = 'in_transit';
      pushHistory(shipment, 'in_transit', req, 'Package dropped at office via QR scan');
    } else if (selectedAction === 'office_pickup') {
      shipment.assignedDeliveryDriver = driverId;
      shipment.status = 'in_transit';
      pushHistory(shipment, 'assigned_delivery_driver', req, 'Auto-assigned via QR scan');
      pushHistory(shipment, 'in_transit', req, 'Package picked up from office for delivery via QR scan');
    } else if (selectedAction === 'assign_delivery') {
      shipment.assignedDeliveryDriver = driverId;
      pushHistory(shipment, 'assigned_delivery_driver', req, 'Auto-assigned via QR scan');
    } else if (selectedAction === 'delivery') {
      shipment.status = 'delivered';
      shipment.deliveredAt = new Date();
      pushHistory(shipment, 'delivered', req, 'Package delivered via QR scan');
      if (shipment.paymentMethod === 'cod' && shipment.totalCollectible > 0) {
        shipment.codCollectedBy = req.user._id;
        shipment.codCollectedAt = new Date();
        shipment.codCollectedAmount = req.body.collectedAmount || shipment.totalCollectible;
      }
    }

    await shipment.save();
    const populated = await populateShipment(Shipment.findById(shipment._id));
    const label = selected.label || decision.label;
    res.json({ action: selectedAction, message: label + ' completed', shipment: populated });
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
    if (shipment.paymentMethod === 'cod' && shipment.codType === 'pay_first') {
      shipment.codPaidToCustomer = true;
      shipment.codPaidToCustomerBy = req.user._id;
      shipment.codPaidToCustomerAt = new Date();
    }
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
    const { remarks, collectedAmount } = req.body;
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
    if (shipment.paymentMethod === 'cod' && shipment.totalCollectible > 0) {
      shipment.codCollectedBy = req.user._id;
      shipment.codCollectedAt = new Date();
      shipment.codCollectedAmount = collectedAmount || shipment.totalCollectible;
    }
    await shipment.save();

    const populated = await populateShipment(Shipment.findById(shipment._id));
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.patch('/shipments/:id/cancel', async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'in_transit') {
      return res.status(400).json({ message: 'Shipment must be in transit to cancel' });
    }
    const isDeliveryDriver = shipment.assignedDeliveryDriver?.toString() === req.user._id.toString();
    const isPickupDriver = shipment.assignedPickupDriver?.toString() === req.user._id.toString();
    if (!isDeliveryDriver && !isPickupDriver) {
      return res.status(403).json({ message: 'You are not assigned to this shipment' });
    }

    shipment.status = 'cancelled';
    pushHistory(shipment, 'cancelled', req, remarks || 'Shipment cancelled by driver');
    await shipment.save();

    const populated = await populateShipment(Shipment.findById(shipment._id));
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.patch('/shipments/:id/return-to-office', async (req, res) => {
  try {
    const { remarks } = req.body;
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    if (shipment.status !== 'in_transit') {
      return res.status(400).json({ message: 'Shipment must be in transit to return to office' });
    }

    const isDeliveryDriver = shipment.assignedDeliveryDriver?.toString() === req.user._id.toString();
    if (!isDeliveryDriver) {
      return res.status(403).json({ message: 'You are not the delivery driver for this shipment' });
    }

    shipment.status = 'returned';
    pushHistory(shipment, 'returned', req, remarks || 'Package returned to office by driver');
    await shipment.save();

    const populated = await populateShipment(Shipment.findById(shipment._id));
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/daily-summary', async (req, res) => {
  try {
    const driverId = req.user._id;
    const uaeOffset = 4 * 60 * 60 * 1000;

    let dayStart, dayEnd, displayDate;
    if (req.query.date) {
      const parts = req.query.date.split('-');
      const uaeDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      dayStart = new Date(uaeDate.getTime() - uaeOffset);
      dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      displayDate = req.query.date;
    } else {
      const now = new Date();
      const uaeNow = new Date(now.getTime() + uaeOffset);
      dayStart = new Date(Date.UTC(uaeNow.getUTCFullYear(), uaeNow.getUTCMonth(), uaeNow.getUTCDate()) - uaeOffset);
      dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      displayDate = uaeNow.toISOString().slice(0, 10);
    }

    const [pickups, deliveries, settlements] = await Promise.all([
      Shipment.find({
        assignedPickupDriver: driverId,
        pickedAt: { $gte: dayStart, $lt: dayEnd },
      })
        .populate('customer', 'name email phone address')
        .populate('createdBy', 'name username')
        .sort({ pickedAt: -1 }),

      Shipment.find({
        assignedDeliveryDriver: driverId,
        deliveredAt: { $gte: dayStart, $lt: dayEnd },
      })
        .populate('customer', 'name email phone address')
        .populate('createdBy', 'name username')
        .sort({ deliveredAt: -1 }),

      Shipment.aggregate([
        {
          $match: {
            $or: [
              { assignedDeliveryDriver: driverId, deliveredAt: { $gte: dayStart, $lt: dayEnd } },
              { assignedPickupDriver: driverId, pickedAt: { $gte: dayStart, $lt: dayEnd } },
              { returnChargeCollectedBy: driverId, returnChargeCollectedAt: { $gte: dayStart, $lt: dayEnd } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            codCollectedTotal: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$assignedDeliveryDriver', null] }, { $eq: ['$assignedDeliveryDriver', driverId] }] },
                  { $ifNull: ['$codCollectedAmount', 0] },
                  0,
                ],
              },
            },
            payFirstTakenTotal: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$codType', 'pay_first'] }, { $eq: ['$codPaidToCustomer', true] }, { $eq: ['$assignedPickupDriver', driverId] }] },
                  { $ifNull: ['$itemValue', 0] },
                  0,
                ],
              },
            },
            returnChargeTotal: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$returnChargeCollectedBy', driverId] }, { $ne: ['$returnChargeCollectedAt', null] }] },
                  { $ifNull: ['$returnCharge', 0] },
                  0,
                ],
              },
            },
            codDeliveryCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$paymentMethod', 'cod'] }, { $eq: ['$assignedDeliveryDriver', driverId] }] },
                  1,
                  0,
                ],
              },
            },
            payFirstCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$codType', 'pay_first'] }, { $eq: ['$codPaidToCustomer', true] }, { $eq: ['$assignedPickupDriver', driverId] }] },
                  1,
                  0,
                ],
              },
            },
            returnChargeCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$returnChargeCollectedBy', driverId] }, { $ne: ['$returnChargeCollectedAt', null] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const fin = settlements[0] || {};
    const codCollectedTotal = fin.codCollectedTotal || 0;
    const payFirstTakenTotal = fin.payFirstTakenTotal || 0;
    const returnChargeTotal = fin.returnChargeTotal || 0;
    const totalAccountability = codCollectedTotal + returnChargeTotal;

    res.json({
      date: displayDate,
      pickups,
      deliveries,
      pickupCount: pickups.length,
      deliveryCount: deliveries.length,
      settlement: {
        codCollectedTotal,
        payFirstTakenTotal,
        returnChargeTotal,
        totalAccountability,
        codDeliveryCount: fin.codDeliveryCount || 0,
        payFirstCount: fin.payFirstCount || 0,
        returnChargeCount: fin.returnChargeCount || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
