const User = require('../models/User');
const AuthLog = require('../models/AuthLog');
const { resetPassword } = require('./authController');

const generateCredentials = async (name, role) => {
  const base = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
  let username = base.length > 20 ? base.slice(0, 20) : base;
  let counter = 1;
  while (await User.findOne({ username, role })) {
    const suffix = String(counter);
    username = (base.length > 20 - suffix.length ? base.slice(0, 20 - suffix.length) : base) + suffix;
    counter++;
  }
  const password = 'Password@123';
  return { username, password };
};

const listDrivers = async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).populate('createdBy', 'name username');
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const createDriver = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const { username, password } = await generateCredentials(name, 'driver');

    const driver = await User.create({
      name, email, phone, username, password,
      role: 'driver', mustChangePassword: true, createdBy: req.user._id,
    });

    await AuthLog.create({
      user: driver._id,
      action: 'password_reset',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ ...driver.toJSON(), defaultPassword: password });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getDriver = async (req, res) => {
  try {
    const driver = await User.findOne({ _id: req.params.id, role: 'driver' }).populate('createdBy', 'name username');
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json(driver);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateDriver = async (req, res) => {
  try {
    const { name, email, phone, status } = req.body;
    const driver = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'driver' },
      { name, email, phone, status },
      { new: true, runValidators: true }
    );
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    res.json(driver);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const toggleDriverStatus = async (req, res) => {
  try {
    const driver = await User.findOne({ _id: req.params.id, role: 'driver' });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });
    driver.status = driver.status === 'active' ? 'inactive' : 'active';
    await driver.save();
    res.json(driver);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const listCustomers = async (req, res) => {
  try {
    const customers = await User.find({ role: 'customer' }).populate('createdBy', 'name username');
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const createCustomer = async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const { username, password } = await generateCredentials(name, 'customer');

    const customer = await User.create({
      name, email, phone, address, username, password,
      role: 'customer', mustChangePassword: true, createdBy: req.user._id,
    });

    await AuthLog.create({
      user: customer._id,
      action: 'password_reset',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ ...customer.toJSON(), defaultPassword: password });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getCustomer = async (req, res) => {
  try {
    const customer = await User.findOne({ _id: req.params.id, role: 'customer' }).populate('createdBy', 'name username');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const { name, email, phone, status, address } = req.body;
    const customer = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'customer' },
      { name, email, phone, status, address },
      { new: true, runValidators: true }
    );
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getUserAuthLogs = async (req, res) => {
  try {
    const logs = await AuthLog.find({ user: req.params.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user', 'name username role');
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  listDrivers, createDriver, getDriver, updateDriver, toggleDriverStatus,
  listCustomers, createCustomer, getCustomer, updateCustomer,
  getUserAuthLogs,
};
