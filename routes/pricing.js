const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const { listPricing, createPricing, updatePricing, deletePricing } = require('../controllers/pricingController');

const router = Router();

router.use(protect, authorize('admin'));

router.get('/', listPricing);
router.post('/', [
  body('name').notEmpty().withMessage('Name is required'),
  body('tiers').isArray({ min: 1 }).withMessage('At least one tier is required'),
  validate,
], createPricing);
router.put('/:id', updatePricing);
router.delete('/:id', deletePricing);

module.exports = router;
