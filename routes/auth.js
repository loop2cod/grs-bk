const { Router } = require('express');
const { body } = require('express-validator');
const { login, changePassword, resetPassword, getProfile } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = Router();

router.post('/login', [
  body('username').optional(),
  body('email').optional(),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
  (req, res, next) => {
    if (!req.body.username && !req.body.email) {
      return res.status(400).json({ message: 'Username or email is required' });
    }
    next();
  },
], login);

router.post('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  validate,
], changePassword);

router.post('/reset-password/:id', protect, resetPassword);

router.get('/profile', protect, getProfile);

module.exports = router;
