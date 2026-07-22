require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const driverRoutes = require('./routes/driver');
const customerRoutes = require('./routes/customer');
const shipmentRoutes = require('./routes/shipment');
const pricingRoutes = require('./routes/pricing');
const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin/shipments', shipmentRoutes);
app.use('/api/admin/pricing', pricingRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
