const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const { listPricing, createPricing, updatePricing, deletePricing } = require('../controllers/pricingController');

const router = Router();

router.use(protect);

router.get('/', authorize('admin', 'customer', 'driver'), listPricing);
router.post('/', authorize('admin'), [
  body('name').notEmpty().withMessage('Name is required'),
  body('tiers').isArray({ min: 1 }).withMessage('At least one tier is required'),
  validate,
], createPricing);
router.put('/:id', authorize('admin'), updatePricing);
router.delete('/:id', authorize('admin'), deletePricing);

module.exports = router;
