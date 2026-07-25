require('dotenv').config()
const bcrypt = require('bcryptjs')
const User = require('./models/User')
const connectDB = require('./config/db')

const PASSWORD = 'Password@123'

const ADDRESSES = [
  'Downtown Dubai, Sheikh Mohammed Bin Rashid Blvd',
  'Abu Dhabi Corniche, Abu Dhabi',
  'Marina Walk, Dubai Marina',
  'Al Reem Island, Abu Dhabi',
  'Jumeirah Beach Residence, Dubai',
  'Al Zahiyah, Abu Dhabi',
  'Palm Jumeirah, Dubai',
  'Al Raha Beach, Abu Dhabi',
  'Dubai Silicon Oasis, Dubai',
  'Khalifa City, Abu Dhabi',
]

const seedCustomers = async () => {
  await connectDB()

  const existing = await User.countDocuments({ role: 'customer' })
  if (existing >= 30) {
    console.log(`${existing} customers already exist — skipping`)
    process.exit(0)
  }

  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(PASSWORD, salt)

  const customers = []
  for (let i = 1; i <= 30; i++) {
    const padded = String(i).padStart(2, '0')
    customers.push({
      name: `Test Customer ${padded}`,
      email: `customer${padded}@grs.com`,
      phone: `+971502000${padded}`,
      username: `test.customer${padded}`,
      address: ADDRESSES[i % ADDRESSES.length],
      password: hashedPassword,
      role: 'customer',
      status: 'active',
      mustChangePassword: false,
    })
  }

  await User.insertMany(customers)
  console.log(`Created ${customers.length} test customers`)
  console.log(`All have password: ${PASSWORD}`)
  console.log(`Usernames: test.customer01 — test.customer${String(customers.length).padStart(2, '0')}`)
  process.exit(0)
}

seedCustomers()
