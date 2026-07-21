require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

const seed = async () => {
  await connectDB();

  const adminExists = await User.findOne({ role: 'admin' });
  if (adminExists) {
    console.log('Admin already exists');
    process.exit(0);
  }

  await User.create({
    name: 'Super Admin',
    email: 'admin@grs.com',
    phone: '+971501234567',
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    status: 'active',
  });

  console.log('Admin seeded: username=admin, password=admin123');
  process.exit(0);
};

seed();
