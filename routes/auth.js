const { Router } = require('express');
const { body } = require('express-validator');
const { login, changePassword, resetPassword, getProfile } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = Router();

router.post('/login', [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
], login);

router.post('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  validate,
], changePassword);

router.post('/reset-password/:id', protect, resetPassword);

router.get('/profile', protect, getProfile);

module.exports = router;
