const { Router } = require('express');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const User = require('../models/User');
const AuthLog = require('../models/AuthLog');

const router = Router();

router.use(protect, authorize('customer'));

router.get('/profile', async (req, res) => {
  try {
    const customer = await User.findById(req.user._id);
    res.json(customer);
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

module.exports = router;
