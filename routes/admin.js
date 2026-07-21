const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const { resetPassword } = require('../controllers/authController');
const {
  listDrivers, createDriver, getDriver, updateDriver, toggleDriverStatus,
  listCustomers, createCustomer, getCustomer, updateCustomer,
  getUserAuthLogs,
} = require('../controllers/adminController');

const router = Router();

router.use(protect, authorize('admin'));

router.get('/drivers', listDrivers);
router.post('/drivers', [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().withMessage('Phone is required'),
  validate,
], createDriver);
router.get('/drivers/:id', getDriver);
router.put('/drivers/:id', updateDriver);
router.patch('/drivers/:id/status', toggleDriverStatus);
router.post('/drivers/:id/reset-password', resetPassword);

router.get('/customers/search', async (req, res) => {
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

router.get('/customers', listCustomers);
router.post('/customers', [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').notEmpty().withMessage('Phone is required'),
  validate,
], createCustomer);
router.get('/customers/:id', getCustomer);
router.put('/customers/:id', updateCustomer);
router.post('/customers/:id/reset-password', resetPassword);

router.get('/auth-logs/:id', getUserAuthLogs);

module.exports = router;
