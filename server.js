require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, param, query, validationResult } = require('express-validator');
// const { Yoco } = require('@lekkercommerce/yoco-node');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// ENVIRONMENT VALIDATION
// ============================================
const requiredEnvVars = ['RESEND_API_KEY', 'MONGODB_URI', 'FRONTEND_URL', 'JWT_SECRET'];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing: ${varName}`);
    process.exit(1);
  }
});

console.log('✅ Environment variables validated');

// ============================================
// INITIALIZE SERVICES
// ============================================
// const yoco = new Yoco({ apiKey: process.env.YOCO_SECRET_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

let db, mongoClient;

const connectDB = async () => {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      useUnifiedTopology: true,
      tls: true,
      tlsAllowInvalidCertificates: false, // true only for testing
      serverSelectionTimeoutMS: 10000
    });
    await mongoClient.connect();
    db = mongoClient.db('orderManagementDB');
    console.log('✅ MongoDB connected');
    await createIndexes();
  } catch (error) {
    console.error('❌ MongoDB failed:', error);
    process.exit(1);
  }
};


const createIndexes = async () => {
  try {
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('orders').createIndex({ userId: 1 });
    await db.collection('orders').createIndex({ orderNumber: 1 }, { unique: true });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('orders').createIndex({ createdAt: -1 });
    await db.collection('testimonials').createIndex({ userId: 1 });
    await db.collection('testimonials').createIndex({ isApproved: 1 });
    await db.collection('messages').createIndex({ orderId: 1 });
    await db.collection('messages').createIndex({ toUserId: 1 });
    await db.collection('messages').createIndex({ isRead: 1 });
    console.log('✅ Indexes created');
  } catch (error) {
    console.error('⚠️ Index warning:', error.message);
  }
};

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/api/', apiLimiter);
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================
// AUTH MIDDLEWARE
// ============================================
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.collection('users').findOne({ _id: new ObjectId(decoded.userId) }, { projection: { password: 0 }});
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const authenticateAdmin = async (req, res, next) => {
  await authenticateToken(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  next();
};

// ============================================
// UTILITIES
// ============================================
const handleError = (res, error, msg = 'Error occurred') => {
  console.error('Error:', error);
  res.status(500).json({ error: msg, ...(process.env.NODE_ENV === 'development' && { details: error.message })});
};

const generateOrderNumber = () => `PB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

// ============================================
// DATABASE INIT
// ============================================
const initDatabase = async () => {
  const adminCount = await db.collection('users').countDocuments({ role: 'admin' });
  if (adminCount === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await db.collection('users').insertOne({
      email: 'admin@portugalbakery.co.za',
      password: hashedPassword,
      firstName: 'Admin', lastName: 'User', phone: '', role: 'admin',
      createdAt: new Date(), lastLogin: new Date()
    });
    console.log('⚠️  Default admin: admin@portugalbakery.co.za / admin123 - CHANGE NOW!');
  }
};

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', async (req, res) => {
  try {
    await db.admin().ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// ============================================
// PAYMENT ENDPOINTS (Yoco)
// ============================================
// app.post('/api/payments/create-yoco', authenticateToken, [
//   body('amount').isFloat({ min: 0.5 }),
//   body('orderNumber').notEmpty()
// ], validate, async (req, res) => {
//   try {
//     const { amount, orderNumber } = req.body;
//     const payment = await yoco.payments.create({
//       amountInCents: Math.round(amount * 100),
//       currency: 'ZAR',
//       reference: orderNumber
//     });
//     res.json({ paymentLink: payment.paymentLink, paymentId: payment.id });
//   } catch (error) {
//     handleError(res, error, 'Yoco payment creation failed');
//   }
// });

// app.post('/api/payments/confirm-yoco', authenticateToken, [
//   body('paymentId').notEmpty(),
//   body('orderNumber').notEmpty()
// ], validate, async (req, res) => {
//   try {
//     const { paymentId, orderNumber } = req.body;
//     const order = await db.collection('orders').findOne({ orderNumber });
//     if (!order) return res.status(404).json({ error: 'Order not found' });
//     await db.collection('orders').updateOne(
//       { orderNumber },
//       { $set: { paymentStatus: 'paid', yocoPaymentId: paymentId, updatedAt: new Date() }}
//     );
//     res.json({ success: true });
//   } catch (error) {
//     handleError(res, error, 'Yoco payment confirmation failed');
//   }
// });

// ============================================
// ORDER ENDPOINTS
// ============================================
app.post('/api/orders', authenticateToken, [
  body('items').isArray({ min: 1 }),
  body('totalAmount').isFloat({ min: 0 })
], validate, async (req, res) => {
  try {
    const { items, totalAmount, shippingAddress, specialInstructions } = req.body;
    const calculated = items.reduce((s, i) => s + (i.price * i.quantity), 0);
    if (Math.abs(calculated - totalAmount) > 0.01) return res.status(400).json({ error: 'Total mismatch' });
    
    const order = {
      userId: req.user._id, orderNumber: generateOrderNumber(),
      status: 'pending', paymentStatus: 'pending', items, totalAmount,
      shippingAddress: shippingAddress || null, specialInstructions: specialInstructions || '',
      trackingNumber: '', estimatedDelivery: null,
      createdAt: new Date(), updatedAt: new Date()
    };
    const result = await db.collection('orders').insertOne(order);
    order._id = result.insertedId;
    console.log('✅ Order created:', order.orderNumber);
    res.json(order);
  } catch (error) {
    handleError(res, error, 'Order creation failed');
  }
});

app.get('/api/orders/my-orders', authenticateToken, async (req, res) => {
  try {
    const orders = await db.collection('orders').find({ userId: req.user._id }).sort({ createdAt: -1 }).toArray();
    res.json(orders);
  } catch (error) {
    handleError(res, error, 'Failed to get orders');
  }
});

app.get('/api/orders/:orderNumber', authenticateToken, [param('orderNumber').matches(/^PB-/)], validate, async (req, res) => {
  try {
    const order = await db.collection('orders').findOne({ orderNumber: req.params.orderNumber });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.user.role !== 'admin' && order.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(order);
  } catch (error) {
    handleError(res, error, 'Failed to get order');
  }
});

app.get('/api/orders', authenticateAdmin, [
  query('status').optional(), query('limit').optional().isInt({ max: 100 })
], validate, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const filter = status ? { status } : {};
    const orders = await db.collection('orders').find(filter).sort({ createdAt: -1 }).skip(+offset).limit(+limit).toArray();
    const total = await db.collection('orders').countDocuments(filter);
    res.json({ orders, total, limit: +limit, offset: +offset });
  } catch (error) {
    handleError(res, error, 'Failed to get orders');
  }
});

app.put('/api/orders/:orderNumber/status', authenticateAdmin, [
  param('orderNumber').matches(/^PB-/),
  body('status').isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
], validate, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const { status } = req.body;
    const result = await db.collection('orders').findOneAndUpdate(
      { orderNumber }, { $set: { status, updatedAt: new Date() }}, { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Order not found' });
    await sendOrderStatusEmail(result.value);
    console.log('✅ Status updated:', orderNumber, '->', status);
    res.json(result.value);
  } catch (error) {
    handleError(res, error, 'Status update failed');
  }
});

// ============================================
// TESTIMONIALS
// ============================================
app.post('/api/testimonials', authenticateToken, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').trim().notEmpty().isLength({ max: 1000 })
], validate, async (req, res) => {
  try {
    const { orderNumber, rating, comment } = req.body;
    const testimonial = {
      userId: req.user._id, orderNumber: orderNumber || null,
      rating, comment, isApproved: false, createdAt: new Date()
    };
    const result = await db.collection('testimonials').insertOne(testimonial);
    res.json({ ...testimonial, _id: result.insertedId });
  } catch (error) {
    handleError(res, error, 'Testimonial failed');
  }
});

app.get('/api/testimonials', [query('limit').optional().isInt({ max: 50 })], validate, async (req, res) => {
  try {
    const testimonials = await db.collection('testimonials').aggregate([
      { $match: { isApproved: true }},
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' }},
      { $unwind: '$user' },
      { $project: { 'user.password': 0, 'user.email': 0, 'user.phone': 0 }},
      { $sort: { createdAt: -1 }},
      { $limit: +(req.query.limit || 20) }
    ]).toArray();
    res.json(testimonials);
  } catch (error) {
    handleError(res, error, 'Failed to get testimonials');
  }
});

app.get('/api/testimonials/all', authenticateAdmin, async (req, res) => {
  try {
    const testimonials = await db.collection('testimonials').aggregate([
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' }},
      { $unwind: '$user' },
      { $project: { 'user.password': 0 }},
      { $sort: { createdAt: -1 }}
    ]).toArray();
    res.json(testimonials);
  } catch (error) {
    handleError(res, error, 'Failed to get all testimonials');
  }
});

app.put('/api/testimonials/:id/approve', authenticateAdmin, [
  param('id').isMongoId(), body('isApproved').isBoolean()
], validate, async (req, res) => {
  try {
    const result = await db.collection('testimonials').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { isApproved: req.body.isApproved }},
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Not found' });
    res.json(result.value);
  } catch (error) {
    handleError(res, error, 'Approval failed');
  }
});

// ============================================
// MESSAGING
// ============================================
app.post('/api/messages/send', authenticateAdmin, [
  body('orderId').isMongoId(),
  body('subject').trim().notEmpty().isLength({ max: 200 }),
  body('message').trim().notEmpty().isLength({ max: 5000 })
], validate, async (req, res) => {
  try {
    const { orderId, subject, message } = req.body;
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    const customer = await db.collection('users').findOne({ _id: order.userId });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    
    const msg = {
      orderId: order._id, orderNumber: order.orderNumber,
      fromUserId: req.user._id, toUserId: customer._id,
      subject, message, isRead: false, emailSent: false, createdAt: new Date()
    };
    const result = await db.collection('messages').insertOne(msg);
    
    try {
      await sendMessageEmail(customer, order, subject, message);
      await db.collection('messages').updateOne({ _id: result.insertedId }, { $set: { emailSent: true, emailSentAt: new Date() }});
      msg.emailSent = true;
    } catch (e) {
      console.error('❌ Email error:', e);
    }
    
    console.log('✅ Message sent:', order.orderNumber);
    res.json({ ...msg, _id: result.insertedId });
  } catch (error) {
    handleError(res, error, 'Message send failed');
  }
});

app.get('/api/messages/order/:orderNumber', authenticateToken, [param('orderNumber').matches(/^PB-/)], validate, async (req, res) => {
  try {
    const order = await db.collection('orders').findOne({ orderNumber: req.params.orderNumber });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.user.role !== 'admin' && order.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const messages = await db.collection('messages').find({ orderId: order._id }).sort({ createdAt: 1 }).toArray();
    if (req.user.role === 'customer') {
      await db.collection('messages').updateMany(
        { orderId: order._id, toUserId: req.user._id, isRead: false },
        { $set: { isRead: true }}
      );
    }
    res.json(messages);
  } catch (error) {
    handleError(res, error, 'Failed to get messages');
  }
});

app.get('/api/messages/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await db.collection('messages').countDocuments({ toUserId: req.user._id, isRead: false });
    res.json({ count });
  } catch (error) {
    handleError(res, error, 'Failed to get count');
  }
});

// ============================================
// EMAIL FUNCTIONS
// ============================================
async function sendOrderConfirmationEmail(order) {
  try {
    const user = await db.collection('users').findOne({ _id: order.userId });
    if (!user) return;
    const items = order.items.map(i => `• ${i.name} x${i.quantity} - R${(i.price * i.quantity).toFixed(2)}`).join('<br>');
    await resend.emails.send({
      from: 'Portugal Bakery <orders@yourdomain.com>',
      to: [user.email],
      subject: `Order Confirmed - ${order.orderNumber}`,
      html: `<div style="font-family:Arial;max-width:600px;margin:0 auto">
        <h1 style="color:#8B4513">Order Confirmed! 🥐</h1>
        <p>Dear ${user.firstName},</p>
        <div style="background:#FFF8DC;padding:20px;border-radius:10px;margin:20px 0">
          <p><strong>Order:</strong> ${order.orderNumber}</p>
          <p>${items}</p>
          <p style="font-size:18px"><strong>Total: R${order.totalAmount.toFixed(2)}</strong></p>
        </div>
        <p>Track: <a href="${process.env.FRONTEND_URL}/track-order?id=${order.orderNumber}">Click here</a></p>
        <p>Best,<br>Portugal Bakery</p>
      </div>`
    });
    console.log('✅ Email sent:', user.email);
  } catch (e) {
    console.error('❌ Email error:', e);
  }
}

async function sendOrderStatusEmail(order) {
  try {
    const user = await db.collection('users').findOne({ _id: order.userId });
    if (!user) return;
    const msgs = {
      pending: 'Order received', processing: 'Preparing your order',
      shipped: 'Order shipped', delivered: 'Order delivered!', cancelled: 'Order cancelled'
    };
    await resend.emails.send({
      from: 'Portugal Bakery <orders@yourdomain.com>',
      to: [user.email],
      subject: `Order Update - ${order.orderNumber}`,
      html: `<div style="font-family:Arial;max-width:600px">
        <h1 style="color:#8B4513">Order Update 📦</h1>
        <div style="background:#FFF8DC;padding:20px;border-radius:10px;margin:20px 0">
          <p><strong>Order:</strong> ${order.orderNumber}</p>
          <p><strong>Status:</strong> ${order.status}</p>
          <p>${msgs[order.status]}</p>
        </div>
        <p>Track: <a href="${process.env.FRONTEND_URL}/track-order?id=${order.orderNumber}">Click here</a></p>
      </div>`
    });
  } catch (e) {
    console.error('❌ Email error:', e);
  }
}

async function sendMessageEmail(customer, order, subject, message) {
  await resend.emails.send({
    from: 'Portugal Bakery <messages@yourdomain.com>',
    to: [customer.email],
    subject: `Message from Portugal Bakery - ${order.orderNumber}`,
    html: `<div style="font-family:Arial;max-width:600px">
      <h1 style="color:#8B4513">New Message 💬</h1>
      <div style="background:#FFF8DC;padding:20px;border-radius:10px;margin:20px 0">
        <p><strong>Order:</strong> ${order.orderNumber}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p style="background:white;padding:15px;border-radius:5px">${message}</p>
      </div>
      <p>View: <a href="${process.env.FRONTEND_URL}/track-order?id=${order.orderNumber}">Click here</a></p>
    </div>`
  });
}

// ============================================
// ERROR HANDLING
// ============================================
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ error: 'Internal error' });
});

// ============================================
// SHUTDOWN
// ============================================
const shutdown = async () => {
  console.log('🔄 Shutting down...');
  try {
    await mongoClient.close();
    console.log('✅ MongoDB closed');
    process.exit(0);
  } catch (e) {
    console.error('❌ Shutdown error:', e);
    process.exit(1);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================
// START SERVER
// ============================================
const start = async () => {
  try {
    await connectDB();
    await initDatabase();
    app.listen(PORT, () => {
      console.log('🚀 Server running on port', PORT);
      console.log('📝 Environment:', process.env.NODE_ENV || 'development');
      console.log('🔗 Frontend:', process.env.FRONTEND_URL);
    });
  } catch (e) {
    console.error('❌ Start failed:', e);
    process.exit(1);
  }
};

start();

module.exports = app;