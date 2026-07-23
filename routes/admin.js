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

module.exports = router;
