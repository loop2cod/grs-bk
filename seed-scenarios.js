// Seed shipments for all test scenarios
const http = require('http');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNjQ4OWM5M2ViZTBlZjIyMjk4ODc1NiIsImlhdCI6MTc4NDk3NDI0OSwiZXhwIjoxNzg1NTc5MDQ5fQ.h28SHwrB5--RjVAO6_qI0J6cKhffGzgugBuDvS83sqU';
const BASE = 'http://localhost:5000';

const PICKUP_DRIVER = '6a648a5369dd078867e14825';
const DELIVERY_DRIVER = '6a648a5369dd078867e14826';
const CUSTOMER_1 = '6a648b0817de76f5f3f50120';
const CUSTOMER_2 = '6a648a1a88b32d3a2a9cf93e';

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = new URL(BASE + path);
    const req = http.request(opts, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const Shipment = require('./models/Shipment');
  const mongoose = require('mongoose');
  await mongoose.connect('mongodb://localhost:27017/grs');

  const scenarios = [
    // [name, method, path, body, steps]
    ['S1: Regular COD - Driver Pickup (full flow)', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_1, deliveryAddress: 'Dubai Marina, Dubai',
      deliveryContactName: 'Ahmed Al Maktoum', deliveryContactPhone: '+971501111111',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'collect_on_delivery', itemValue: 150,
      pickupType: 'driver_pickup', customAmount: 50, notes: 'S1: Full flow regular COD',
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-pickup-driver', { driverId: PICKUP_DRIVER, remarks: 'S1' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-picked', { remarks: 'S1' }],
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S1' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S1' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S1', collectedAmount: 200 }],
    ]],

    ['S2: Regular COD - Office Drop-off', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_1, deliveryAddress: 'Sharjah Mega Mall, Sharjah',
      deliveryContactName: 'Fatima Hassan', deliveryContactPhone: '+971502222222',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'collect_on_delivery', itemValue: 300,
      pickupType: 'office_dropoff', customAmount: 80, notes: 'S2: Office drop-off',
      assignedPickupDriver: PICKUP_DRIVER,
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S2' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S2' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S2', collectedAmount: 380 }],
    ]],

    ['S3: Pay-first COD - Driver Pickup (two drivers)', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_2, deliveryAddress: 'Al Wahda Mall, Abu Dhabi',
      deliveryContactName: 'Khalid Al Nuaimi', deliveryContactPhone: '+971503333333',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'pay_first', itemValue: 120,
      pickupType: 'driver_pickup', customAmount: 80, notes: 'S3: Pay-first two drivers',
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-pickup-driver', { driverId: PICKUP_DRIVER, remarks: 'S3' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-picked', { remarks: 'S3' }],
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S3' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S3' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S3', collectedAmount: 200 }],
    ]],

    ['S4: Pay-first COD - Office Drop-off', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_1, deliveryAddress: 'Al Qusais, Dubai',
      deliveryContactName: 'Saeed Mohammad', deliveryContactPhone: '+971504444444',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'pay_first', itemValue: 200,
      pickupType: 'office_dropoff', customAmount: 100, notes: 'S4: Pay-first office drop',
      assignedPickupDriver: PICKUP_DRIVER,
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S4' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S4' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S4', collectedAmount: 300 }],
    ]],

    ['S5: Fully Paid - Driver Pickup', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_2, deliveryAddress: 'Al Barsha, Dubai',
      deliveryContactName: 'Layla Ibrahim', deliveryContactPhone: '+971505555555',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'paid', pickupType: 'driver_pickup', customAmount: 75,
      notes: 'S5: Fully paid',
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-pickup-driver', { driverId: PICKUP_DRIVER, remarks: 'S5' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-picked', { remarks: 'S5' }],
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S5' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S5' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S5' }],
    ]],

    ['S6: Partially Paid - Office Drop-off', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_1, deliveryAddress: 'Al Zahra, Abu Dhabi',
      deliveryContactName: 'Omar Rashid', deliveryContactPhone: '+971506666666',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'partial', paidAmount: 30, pickupType: 'office_dropoff', customAmount: 100,
      notes: 'S6: Partial paid',
      assignedPickupDriver: PICKUP_DRIVER,
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S6' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S6' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S6' }],
    ]],

    ['S7: Returned with Return Charge', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_2, deliveryAddress: 'Al Nahda, Sharjah',
      deliveryContactName: 'Hind Abdullah', deliveryContactPhone: '+971507777777',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'collect_on_delivery', itemValue: 250,
      pickupType: 'driver_pickup', customAmount: 60, notes: 'S7: Returned with charge',
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-pickup-driver', { driverId: PICKUP_DRIVER, remarks: 'S7' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-picked', { remarks: 'S7' }],
    ]],

    ['S8: Returned to Sender', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_1, deliveryAddress: 'Al Majaz, Sharjah',
      deliveryContactName: 'Noura Ali', deliveryContactPhone: '+971508888888',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'collect_on_delivery', itemValue: 180,
      pickupType: 'driver_pickup', customAmount: 45, notes: 'S8: Returned to sender',
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-pickup-driver', { driverId: PICKUP_DRIVER, remarks: 'S8' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-picked', { remarks: 'S8' }],
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S8' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S8' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S8', collectedAmount: 225 }],
    ]],

    ['S9: Pending Unassigned', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_2, deliveryAddress: 'Al Reem Island, Abu Dhabi',
      deliveryContactName: 'Mona Al Shehhi', deliveryContactPhone: '+971509999999',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'collect_on_delivery', itemValue: 500,
      pickupType: 'driver_pickup', customAmount: 120, notes: 'S9: Pending',
    }, []],

    ['S10: In Transit - Not Delivered', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_1, deliveryAddress: 'Al Rigga, Dubai',
      deliveryContactName: 'Rashid Al Farsi', deliveryContactPhone: '+971500000001',
      items: [{ description: 'Test Item', quantity: 1, weight: 2.5 }],
      paymentMethod: 'cod', codType: 'collect_on_delivery', itemValue: 90,
      pickupType: 'driver_pickup', customAmount: 35, notes: 'S10: In transit',
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-pickup-driver', { driverId: PICKUP_DRIVER, remarks: 'S10' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-picked', { remarks: 'S10' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S10' }],
    ]],

    ['S11: Pay-first COD - Office Drop-off (large)', 'POST', '/api/admin/shipments', {
      customer: CUSTOMER_2, deliveryAddress: 'Al Barsha South, Dubai',
      deliveryContactName: 'Yusuf Mohammed', deliveryContactPhone: '+971508888889',
      items: [{ description: 'Electronics', quantity: 1, weight: 1.0 }],
      paymentMethod: 'cod', codType: 'pay_first', itemValue: 350,
      pickupType: 'office_dropoff', customAmount: 150, notes: 'S11: Pay-first office',
      assignedPickupDriver: PICKUP_DRIVER,
    }, [
      ['PATCH', '/api/admin/shipments/{id}/assign-delivery-driver', { driverId: DELIVERY_DRIVER, remarks: 'S11' }],
      ['PATCH', '/api/admin/shipments/{id}/mark-in-transit', { remarks: 'S11' }],
      ['PATCH', '/api/admin/shipments/{id}/deliver', { remarks: 'S11', collectedAmount: 500 }],
    ]],
  ];

  for (const [name, method, path, body, steps] of scenarios) {
    process.stdout.write(`${name}... `);
    const res = await api(method, path, body);
    if (res.status >= 400) {
      console.log(`FAIL (create): ${JSON.stringify(res.body)}`);
      continue;
    }
    const id = res.body._id;
    let ok = true;
    for (const [smethod, spath, sbody] of steps) {
      const url = spath.replace('{id}', id);
      const sres = await api(smethod, url, sbody);
      if (sres.status >= 400) {
        console.log(`step ${smethod} ${url} FAIL (${sres.status}): ${JSON.stringify(sres.body)}`);
        ok = false;
        break;
      }
    }
    if (ok) console.log('✓');
  }

  // S7: Set returned status with return charge directly
  process.stdout.write('S7: Setting returned + return charge... ');
  const s7 = await Shipment.findOne({ notes: 'S7: Returned with charge' }).sort({ createdAt: -1 });
  if (s7) {
    s7.status = 'returned';
    s7.returnCharge = 25;
    s7.returnChargeCollectedBy = PICKUP_DRIVER;
    s7.returnChargeCollectedAt = new Date();
    s7.statusHistory.push({ status: 'returned', changedBy: PICKUP_DRIVER, changedAt: new Date(), remarks: 'Package returned with 25 AED charge' });
    await s7.save();
    console.log('✓');
  } else { console.log('not found'); }

  // S8: Set returned_to_sender
  process.stdout.write('S8: Setting returned_to_sender... ');
  const s8 = await Shipment.findOne({ notes: 'S8: Returned to sender' }).sort({ createdAt: -1 });
  if (s8) {
    s8.returnToSender = true;
    s8.status = 'returned_to_sender';
    s8.statusHistory.push({ status: 'returned_to_sender', changedBy: DELIVERY_DRIVER, changedAt: new Date(), remarks: 'Returned to sender' });
    await s8.save();
    console.log('✓');
  } else { console.log('not found'); }

  console.log('\nDone!');
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
