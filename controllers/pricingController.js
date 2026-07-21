const PricingSetting = require('../models/PricingSetting');

const listPricing = async (req, res) => {
  try {
    const pricing = await PricingSetting.find().sort({ createdAt: -1 });
    res.json(pricing);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const createPricing = async (req, res) => {
  try {
    const { name, tiers, isDefault } = req.body;

    if (isDefault) {
      await PricingSetting.updateMany({}, { isDefault: false });
    }

    const pricing = await PricingSetting.create({ name, tiers, isDefault });
    res.status(201).json(pricing);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updatePricing = async (req, res) => {
  try {
    const { name, tiers, isDefault } = req.body;

    if (isDefault) {
      await PricingSetting.updateMany({ _id: { $ne: req.params.id } }, { isDefault: false });
    }

    const pricing = await PricingSetting.findByIdAndUpdate(
      req.params.id,
      { name, tiers, isDefault },
      { new: true, runValidators: true }
    );
    if (!pricing) return res.status(404).json({ message: 'Pricing setting not found' });
    res.json(pricing);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const deletePricing = async (req, res) => {
  try {
    const pricing = await PricingSetting.findByIdAndDelete(req.params.id);
    if (!pricing) return res.status(404).json({ message: 'Pricing setting not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { listPricing, createPricing, updatePricing, deletePricing };
