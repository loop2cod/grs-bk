const { Router } = require('express');
const Shipment = require('../models/Shipment');
const { generateLabel } = require('../services/labelService');

const router = Router();

router.get('/label/:id', async (req, res) => {
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
