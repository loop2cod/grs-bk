const { Router } = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleCheck');
const { validate } = require('../middleware/validate');
const {
  listShipments, getShipment, createShipment,
  assignPickupDriver, assignDeliveryDriver,
  markAsPicked, markAsInTransit, handoverToCourier,
  markDelivered, cancelShipment,
} = require('../controllers/shipmentController');
const Shipment = require('../models/Shipment');
const { generateLabel } = require('../services/labelService');

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
router.patch('/:id/assign-pickup-driver', [
  body('driverId').notEmpty().withMessage('Driver is required'),
  validate,
], assignPickupDriver);
router.patch('/:id/assign-delivery-driver', [
  body('driverId').notEmpty().withMessage('Driver is required'),
  validate,
], assignDeliveryDriver);
router.patch('/:id/mark-picked', markAsPicked);
router.patch('/:id/mark-in-transit', markAsInTransit);
router.patch('/:id/handover-courier', [
  body('partnerName').notEmpty().withMessage('Courier partner name is required'),
  validate,
], handoverToCourier);
router.patch('/:id/deliver', markDelivered);
router.patch('/:id/cancel', cancelShipment);
router.get('/:id/label', async (req, res) => {
  try {
    const shipment = await Shipment.findById(req.params.id)
      .populate('customer', 'name')
      .populate('createdBy', 'name role');
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    const pdf = await generateLabel(shipment);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="label-${shipment.trackingNumber}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate label', error: error.message });
  }
});

module.exports = router;
