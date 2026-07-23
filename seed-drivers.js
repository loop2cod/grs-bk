require('dotenv').config()
const bcrypt = require('bcryptjs')
const User = require('./models/User')
const connectDB = require('./config/db')

const PASSWORD = 'Password@123'

const seedDrivers = async () => {
  await connectDB()

  const existing = await User.countDocuments({ role: 'driver' })
  if (existing >= 30) {
    console.log(`${existing} drivers already exist — skipping`)
    process.exit(0)
  }

  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(PASSWORD, salt)

  const drivers = []
  for (let i = 1; i <= 30; i++) {
    const padded = String(i).padStart(2, '0')
    drivers.push({
      name: `Test Driver ${padded}`,
      email: `driver${padded}@grs.com`,
      phone: `+971500000${padded}`,
      username: `test.driver${padded}`,
      password: hashedPassword,
      role: 'driver',
      status: 'active',
      mustChangePassword: false,
    })
  }

  await User.insertMany(drivers)
  console.log(`Created ${drivers.length} test drivers`)
  console.log(`All have password: ${PASSWORD}`)
  console.log(`Usernames: test.driver01 — test.driver${String(drivers.length).padStart(2, '0')}`)
  process.exit(0)
}

seedDrivers()
