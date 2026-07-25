const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const { resetPassword } = require('../controllers/authController');
const {
  listAdmins, createAdmin, updateProfile,
  listDrivers, createDriver, getDriver, updateDriver, toggleDriverStatus,
  listCustomers, createCustomer, getCustomer, updateCustomer,
  getUserAuthLogs,
} = require('../controllers/adminController');
const router = Router();

router.use(protect);

const adminOnly = authorize('admin');

// Admin self-profile
router.put('/profile', adminOnly, updateProfile);

// Admins
router.get('/admins', adminOnly, listAdmins);
router.post('/create', adminOnly, [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().withMessage('Phone is required'),
  validate,
], createAdmin);

// Drivers
router.get('/drivers', adminOnly, listDrivers);
router.post('/drivers', adminOnly, [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().withMessage('Phone is required'),
  validate,
], createDriver);
router.get('/drivers/:id', adminOnly, getDriver);
router.put('/drivers/:id', adminOnly, updateDriver);
router.patch('/drivers/:id/status', adminOnly, toggleDriverStatus);
router.post('/drivers/:id/reset-password', adminOnly, resetPassword);

// Customers
router.get('/customers/search', adminOnly, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) return res.json([]);
    const User = require('../models/User');
    const customers = await User.find({
      role: 'customer',
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { username: { $regex: q, $options: 'i' } },
      ],
    }).limit(10).select('name email phone username address status');
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/customers', adminOnly, listCustomers);
router.post('/customers', adminOnly, [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().withMessage('Phone is required'),
  validate,
], createCustomer);
router.get('/customers/:id', adminOnly, getCustomer);
router.put('/customers/:id', adminOnly, updateCustomer);
router.post('/customers/:id/reset-password', adminOnly, resetPassword);

// Auth logs
router.get('/auth-logs/:id', adminOnly, getUserAuthLogs);

// ── Financial Reports ──

function dateMatch(dateFrom, dateTo, field) {
  if (!dateFrom && !dateTo) return null;
  const cond = {};
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    cond.$gte = from;
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    cond.$lte = to;
  }
  return { [field]: cond };
}

// Overall financial summary
router.get('/financial/summary', adminOnly, async (req, res) => {
  try {
    const Shipment = require('../models/Shipment');
    const { dateFrom, dateTo } = req.query;

    const codDateMatch = dateMatch(dateFrom, dateTo, 'codCollectedAt');
    const pfDateMatch = dateMatch(dateFrom, dateTo, 'codPaidToCustomerAt');
    const rcDateMatch = dateMatch(dateFrom, dateTo, 'returnChargeCollectedAt');
    const createdDateMatch = dateMatch(dateFrom, dateTo, 'createdAt');

    const [codStats, payFirstStats, returnStats, shipmentStats] = await Promise.all([
      Shipment.aggregate([
        { $match: { ...(codDateMatch || { codCollectedBy: { $ne: null } }), codCollectedBy: { $ne: null } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$codCollectedAmount', 0] } }, count: { $sum: 1 } } },
      ]),
      Shipment.aggregate([
        { $match: { ...(pfDateMatch || {}), codPaidToCustomer: true, codType: 'pay_first' } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$itemValue', 0] } }, count: { $sum: 1 } } },
      ]),
      Shipment.aggregate([
        { $match: { ...(rcDateMatch || { returnChargeCollectedBy: { $ne: null } }), returnChargeCollectedBy: { $ne: null } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$returnCharge', 0] } }, count: { $sum: 1 } } },
      ]),
      Shipment.aggregate([
        { $match: createdDateMatch || {} },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            codTotal: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cod'] }, 1, 0] } },
            paidTotal: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'paid'] }, 1, 0] } },
            deliveredCount: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
            pendingCod: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$paymentMethod', 'cod'] }, { $ne: ['$status', 'delivered'] }, { $ne: ['$status', 'cancelled'] }] },
                  { $ifNull: ['$totalCollectible', 0] },
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const cs = codStats[0] || { total: 0, count: 0 };
    const ps = payFirstStats[0] || { total: 0, count: 0 };
    const rs = returnStats[0] || { total: 0, count: 0 };
    const ss = shipmentStats[0] || { total: 0, codTotal: 0, paidTotal: 0, deliveredCount: 0, pendingCod: 0 };

    res.json({
      shipments: { total: ss.total, cod: ss.codTotal, paid: ss.paidTotal, delivered: ss.deliveredCount },
      codCollected: { total: cs.total, count: cs.count },
      payFirstGiven: { total: ps.total, count: ps.count },
      returnCharges: { total: rs.total, count: rs.count },
      pendingCodAmount: ss.pendingCod,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Per-driver settlement summary
router.get('/financial/drivers', adminOnly, async (req, res) => {
  try {
    const Shipment = require('../models/Shipment');
    const User = require('../models/User');
    const { dateFrom, dateTo } = req.query;

    const codDateMatch = dateMatch(dateFrom, dateTo, 'codCollectedAt');
    const pfDateMatch = dateMatch(dateFrom, dateTo, 'codPaidToCustomerAt');
    const rcDateMatch = dateMatch(dateFrom, dateTo, 'returnChargeCollectedAt');

    const [byDelivery, byPayFirst, byReturn] = await Promise.all([
      Shipment.aggregate([
        { $match: { ...(codDateMatch || { codCollectedBy: { $ne: null } }), codCollectedBy: { $ne: null }, assignedDeliveryDriver: { $ne: null } } },
        { $group: { _id: '$assignedDeliveryDriver', codCollectedTotal: { $sum: { $ifNull: ['$codCollectedAmount', 0] } }, codDeliveryCount: { $sum: 1 } } },
      ]),
      Shipment.aggregate([
        { $match: { ...(pfDateMatch || {}), codPaidToCustomer: true, codType: 'pay_first' } },
        { $group: { _id: '$codPaidToCustomerBy', payFirstTotal: { $sum: { $ifNull: ['$itemValue', 0] } }, payFirstCount: { $sum: 1 } } },
      ]),
      Shipment.aggregate([
        { $match: { ...(rcDateMatch || { returnChargeCollectedBy: { $ne: null } }), returnChargeCollectedBy: { $ne: null } } },
        { $group: { _id: '$returnChargeCollectedBy', returnChargeTotal: { $sum: { $ifNull: ['$returnCharge', 0] } }, returnChargeCount: { $sum: 1 } } },
      ]),
    ]);

    const driverMap = new Map();
    for (const d of byDelivery) {
      const id = d._id?.toString();
      if (!id) continue;
      driverMap.set(id, { driverId: id, codCollectedTotal: d.codCollectedTotal, codDeliveryCount: d.codDeliveryCount, payFirstTotal: 0, payFirstCount: 0, returnChargeTotal: 0, returnChargeCount: 0 });
    }
    for (const d of byPayFirst) {
      const id = d._id?.toString();
      if (!id) continue;
      const existing = driverMap.get(id) || { driverId: id, codCollectedTotal: 0, codDeliveryCount: 0, payFirstTotal: 0, payFirstCount: 0, returnChargeTotal: 0, returnChargeCount: 0 };
      existing.payFirstTotal = d.payFirstTotal;
      existing.payFirstCount = d.payFirstCount;
      driverMap.set(id, existing);
    }
    for (const d of byReturn) {
      const id = d._id?.toString();
      if (!id) continue;
      const existing = driverMap.get(id) || { driverId: id, codCollectedTotal: 0, codDeliveryCount: 0, payFirstTotal: 0, payFirstCount: 0, returnChargeTotal: 0, returnChargeCount: 0 };
      existing.returnChargeTotal = d.returnChargeTotal;
      existing.returnChargeCount = d.returnChargeCount;
      driverMap.set(id, existing);
    }

    const driverIds = [...driverMap.keys()];
    const drivers = driverIds.length > 0 ? await User.find({ _id: { $in: driverIds } }).select('name username phone status') : [];

    const driverLookup = new Map(drivers.map(d => [d._id.toString(), d]));
    const result = [...driverMap.values()].map(d => {
      const driver = driverLookup.get(d.driverId);
      return {
        driverId: d.driverId,
        name: driver?.name || 'Unknown',
        username: driver?.username || '',
        phone: driver?.phone || '',
        status: driver?.status || 'inactive',
        codCollectedTotal: d.codCollectedTotal,
        codDeliveryCount: d.codDeliveryCount,
        payFirstTotal: d.payFirstTotal,
        payFirstCount: d.payFirstCount,
        returnChargeTotal: d.returnChargeTotal,
        returnChargeCount: d.returnChargeCount,
        totalAccountability: d.codCollectedTotal + d.returnChargeTotal,
      };
    }).sort((a, b) => b.totalAccountability - a.totalAccountability);

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Single driver detailed settlement
router.get('/financial/driver/:id', adminOnly, async (req, res) => {
  try {
    const Shipment = require('../models/Shipment');
    const mongoose = require('mongoose');
    const driverId = req.params.id;
    const driverOid = mongoose.Types.ObjectId.createFromHexString(driverId);
    const { dateFrom, dateTo } = req.query;

    const aggMatch = {
      $or: [
        { assignedDeliveryDriver: driverOid, deliveredAt: { $ne: null } },
        { assignedPickupDriver: driverOid, pickedAt: { $ne: null } },
      ],
    };
    const findMatch = {
      $or: [
        { assignedDeliveryDriver: driverId, deliveredAt: { $ne: null } },
        { assignedPickupDriver: driverId, pickedAt: { $ne: null } },
      ],
    };

    if (dateFrom || dateTo) {
      const dateCond = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        dateCond.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        dateCond.$lte = to;
      }
      aggMatch.$or = [
        { assignedDeliveryDriver: driverOid, deliveredAt: dateCond },
        { assignedPickupDriver: driverOid, pickedAt: dateCond },
      ];
      findMatch.$or = [
        { assignedDeliveryDriver: driverId, deliveredAt: dateCond },
        { assignedPickupDriver: driverId, pickedAt: dateCond },
      ];
    }

    const [settlement, shipments] = await Promise.all([
      Shipment.aggregate([
        { $match: aggMatch },
        {
          $group: {
            _id: null,
            codCollectedTotal: {
              $sum: {
                $cond: [{ $eq: ['$assignedDeliveryDriver', driverOid] }, { $ifNull: ['$codCollectedAmount', 0] }, 0],
              },
            },
            codDeliveryCount: {
              $sum: {
                $cond: [{ $eq: ['$assignedDeliveryDriver', driverOid] }, 1, 0],
              },
            },
            payFirstTotal: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$codType', 'pay_first'] }, { $eq: ['$codPaidToCustomer', true] }, { $eq: ['$assignedPickupDriver', driverOid] }] },
                  { $ifNull: ['$itemValue', 0] },
                  0,
                ],
              },
            },
            payFirstCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$codType', 'pay_first'] }, { $eq: ['$codPaidToCustomer', true] }, { $eq: ['$assignedPickupDriver', driverOid] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Shipment.find(findMatch)
        .populate('customer', 'name')
        .select('trackingNumber status paymentMethod codType itemValue deliveryCharge totalCollectible codCollectedAmount codPaidToCustomer codPaidToCustomerAt codCollectedAt deliveredAt pickedAt assignedPickupDriver assignedDeliveryDriver')
        .sort({ deliveredAt: -1, pickedAt: -1 }),
    ]);

    const s = settlement[0] || { codCollectedTotal: 0, codDeliveryCount: 0, payFirstTotal: 0, payFirstCount: 0 };

    res.json({
      driverId,
      settlement: {
        codCollectedTotal: s.codCollectedTotal,
        codDeliveryCount: s.codDeliveryCount,
        payFirstTotal: s.payFirstTotal,
        payFirstCount: s.payFirstCount,
        totalAccountability: s.codCollectedTotal,
      },
      shipments,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Pay-first orders tracking
router.get('/financial/pay-first', adminOnly, async (req, res) => {
  try {
    const Shipment = require('../models/Shipment');
    const { dateFrom, dateTo } = req.query;

    const filter = { codType: 'pay_first' };
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const shipments = await Shipment.find(filter)
      .populate('customer', 'name')
      .populate('assignedPickupDriver', 'name username')
      .populate('assignedDeliveryDriver', 'name username')
      .populate('codPaidToCustomerBy', 'name username')
      .populate('codCollectedBy', 'name username')
      .select('trackingNumber status itemValue deliveryCharge totalCollectible codPaidToCustomer codPaidToCustomerAt codCollectedAmount codCollectedBy codCollectedAt assignedPickupDriver assignedDeliveryDriver')
      .sort({ createdAt: -1 });

    res.json(shipments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
