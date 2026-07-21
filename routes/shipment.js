const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const { listShipments, getShipment, createShipment, updateShipmentStatus } = require('../controllers/shipmentController');

const router = Router();

router.use(protect, authorize('admin'));

router.get('/', listShipments);
router.post('/', [
  body('customer').notEmpty().withMessage('Customer is required'),
  body('deliveryAddress').notEmpty().withMessage('Delivery address is required'),
  body('deliveryContactName').notEmpty().withMessage('Contact name is required'),
  body('deliveryContactPhone').notEmpty().withMessage('Contact phone is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('paymentMethod').isIn(['cod', 'paid', 'partial']).withMessage('Invalid payment method'),
  validate,
], createShipment);
router.get('/:id', getShipment);
router.patch('/:id/status', [
  body('status').isIn(['pending', 'in_transit', 'delivered', 'cancelled']),
  validate,
], updateShipmentStatus);

module.exports = router;
