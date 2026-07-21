const mongoose = require('mongoose');

const authLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: {
    type: String,
    enum: ['login', 'logout', 'password_change', 'password_reset'],
    required: true,
  },
  ipAddress: { type: String },
  userAgent: { type: String },
}, { timestamps: true });

authLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AuthLog', authLogSchema);
