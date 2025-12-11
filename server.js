require('dotenv').config();

const express = require('express');
const { ObjectId } = require('mongodb');
const cors = require('cors');
const { Resend } = require('resend');
const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, param, query, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment validation
const requiredEnvVars = ['RESEND_API_KEY', 'MONGODB_URI', 'FRONTEND_URL', 'JWT_SECRET'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing: ${varName}`);
    process.exit(1);
  }
});
console.log('✅ Environment variables validated');

// Initialize services
const resend = new Resend(process.env.RESEND_API_KEY);
let db, mongoClient;

const connectDB = async () => {
  try {
    const options = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      family: 4,
      tls: true,
      retryWrites: true,
      retryReads: true,
      maxPoolSize: 10,
      minPoolSize: 2
    };

    console.log('🔄 Connecting to MongoDB...');
    mongoClient = new MongoClient(process.env.MONGODB_URI, options);
    await mongoClient.connect();
    db = mongoClient.db('mydatabase');
    await db.admin().ping();

    console.log('✅ MongoDB connected:', db.databaseName);
    await createIndexes();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
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
    await db.collection('support_messages').createIndex({ userId: 1 });
    await db.collection('support_messages').createIndex({ createdAt: -1 });
    await db.collection('messages').createIndex({ orderId: 1 });
    await db.collection('messages').createIndex({ toUserId: 1 });
    await db.collection('carts').createIndex({ userId: 1 }, { unique: true }); // NEW: Cart index
    await db.collection('products').createIndex({ id: 1 }, { unique: true });
    await db.collection('products').createIndex({ category: 1 });
    await db.collection('products').createIndex({ name: 'text' }); // For search
    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('⚠️ Index creation warning:', error.message);
  }
};

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL,      // Netlify
      "http://localhost:8080",       // Local dev
      "http://localhost:5173",       // Vite dev
      "http://localhost:3000"        // Local fallback
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/', apiLimiter);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { password: 0 } }
    );

    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const authenticateAdmin = async (req, res, next) => {
  await authenticateToken(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  next();
};

const isValidProductId = (value) => {
  // Accept numeric IDs
  if (!isNaN(Number(value)) && Number.isInteger(Number(value)) && Number(value) > 0) {
    return true;
  }
  // Accept MongoDB ObjectIds (24 character hex strings)
  if (ObjectId.isValid(value) && value.length === 24) {
    return true;
  }
  throw new Error('Product ID must be a valid number or MongoDB ObjectId');
};

// Product-specific validation middleware
const validateProductId = [
  param('id').custom(isValidProductId)
];


const handleError = (res, error, msg = 'An error occurred') => {
  console.error('Error:', error);
  res.status(500).json({
    error: msg,
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
};

const generateOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `PB-${timestamp}-${random}`;
};

const authenticateSSE = async (req, res, next) => {
  try {
    let token = req.query.token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { password: 0 } }
    );

    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ADD THIS FUNCTION HERE:
const serializeProduct = (product) => {
  if (!product) return null;
  return {
    ...product,
    _id: product._id.toString()
  };
};

const initDatabase = async () => {
  try {
    const adminCount = await db.collection('users').countDocuments({ role: 'admin' });
    if (adminCount === 0) {
      await db.collection('users').insertOne({
        email: 'admin@portugalbakery.co.za',
        password: await bcrypt.hash('admin123', 10),
        firstName: 'Admin',
        lastName: 'User',
        phone: '',
        role: 'admin',
        createdAt: new Date(),
        lastLogin: new Date()
      });
      console.log('⚠️  Default admin: admin@portugalbakery.co.za / admin123');
    }
  } catch (error) {
    console.error('❌ Init error:', error);
  }
};

// Update sendOrderConfirmationEmail function (around line 295)
async function sendOrderConfirmationEmail(order) {
  try {
    const user = await db.collection('users').findOne({ _id: order.userId });
    if (!user) {
      console.error('❌ User not found for order:', order.orderNumber);
      return;
    }

    const items = order.items.map(i =>
      `• ${i.name} x${i.quantity} - R${(i.price * i.quantity).toFixed(2)}`
    ).join('<br>');

    // ✅ DELIVERY METHOD DISPLAY
    const deliveryInfo = order.deliveryMethod === 'delivery'
      ? `<p><strong>Delivery Method:</strong> 🚚 Home Delivery</p>
         ${order.address ? `<p><strong>Delivery Address:</strong><br>${order.address}</p>` : ''}`
      : `<p><strong>Delivery Method:</strong> 🏪 Store Pickup</p>
         <div style="background:#E0F2FE;padding:15px;border-radius:8px;border-left:4px solid #0284C7;margin-top:10px">
           <p style="margin:0;font-size:14px;color:#075985">
             <strong>📍 Pickup Location:</strong><br>
             Portugal Bakery<br>
             123 Main Street, Johannesburg<br>
             Mon-Sat: 7:00 AM - 6:00 PM | Sun: 8:00 AM - 2:00 PM
           </p>
         </div>`;

    await resend.emails.send({
      from: 'Portugal Bakery <onboarding@resend.dev>',
      to: user.email,
      subject: `Order Confirmed - ${order.orderNumber}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#8B4513">Order Confirmed! 🥐</h1>
        <p>Dear ${user.firstName}, thank you for your order!</p>
        <div style="background:#FFF8DC;padding:20px;border-radius:10px;margin:20px 0">
          <p><strong>Order Number:</strong> ${order.orderNumber}</p>
          
          ${deliveryInfo}
          
          ${order.phone ? `<p style="margin-top:10px"><strong>Phone:</strong> ${order.phone}</p>` : ''}
          
          <p style="margin-top:15px"><strong>Items:</strong></p>
          <p>${items}</p>
          <p style="font-size:18px;margin-top:15px;color:#8B4513">
            <strong>Total: R${order.totalAmount.toFixed(2)}</strong>
          </p>
        </div>
        ${order.specialInstructions ? `
          <div style="background:#FEF3C7;padding:15px;border-radius:8px;border-left:4px solid #F59E0B;margin:20px 0">
            <p style="margin:0;font-size:14px;color:#92400E">
              <strong>Special Instructions:</strong><br>
              ${order.specialInstructions}
            </p>
          </div>
        ` : ''}
        <p style="font-size:14px;color:#666;margin-top:20px">
          ${order.deliveryMethod === 'pickup'
          ? "We'll notify you when your order is ready for pickup."
          : "We'll send you updates as your order is being prepared and delivered."}
        </p>
        <p>Best regards,<br>Portugal Bakery Team</p>
      </div>`
    });

    console.log('✅ Order confirmation email sent:', user.email, order.orderNumber);
  } catch (error) {
    console.error('❌ Failed to send order confirmation email:', error);
  }
}

async function sendOrderStatusEmail(order) {
  try {
    const user = await db.collection('users').findOne({ _id: order.userId });
    if (!user) {
      console.error('❌ User not found for order:', order.orderNumber);
      return;
    }

    // ✅ DIFFERENT MESSAGES FOR DELIVERY VS PICKUP
    const statusMessages = {
      pending: {
        title: 'Order Received 📝',
        message: order.deliveryMethod === 'pickup'
          ? 'We have received your order and will start preparing it for pickup.'
          : 'We have received your order and will start preparing it for delivery.',
        color: '#F59E0B'
      },
      processing: {
        title: 'Order Being Prepared 👨‍🍳',
        message: 'Your delicious items are being freshly baked right now!',
        color: '#F97316'
      },
      shipped: {
        title: order.deliveryMethod === 'pickup' ? 'Order Ready for Pickup 🎉' : 'Order on the Way 🚗',
        message: order.deliveryMethod === 'pickup'
          ? 'Your order is ready! Come pick it up at our store during business hours.'
          : 'Your order is on its way to you. Get ready to enjoy!',
        color: '#3B82F6'
      },
      delivered: {
        title: order.deliveryMethod === 'pickup' ? 'Order Collected ✅' : 'Order Delivered ✅',
        message: order.deliveryMethod === 'pickup'
          ? 'Thank you for picking up your order. Enjoy your treats!'
          : 'Your order has been delivered. Enjoy your treats!',
        color: '#10B981'
      },
      cancelled: {
        title: 'Order Cancelled ❌',
        message: 'Your order has been cancelled. If this was a mistake, please contact us.',
        color: '#EF4444'
      }
    };

    const statusInfo = statusMessages[order.status] || statusMessages.pending;

    await resend.emails.send({
      from: 'Portugal Bakery <onboarding@resend.dev>',
      to: user.email,
      subject: `Order Update - ${order.orderNumber}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:${statusInfo.color}">${statusInfo.title}</h1>
        <p>Dear ${user.firstName},</p>
        <p>Your order status has been updated:</p>
        <div style="background:#FFF8DC;padding:20px;border-radius:10px;margin:20px 0;border-left:4px solid ${statusInfo.color}">
          <p><strong>Order Number:</strong> ${order.orderNumber}</p>
          <p><strong>Delivery Method:</strong> ${order.deliveryMethod === 'pickup' ? '🏪 Store Pickup' : '🚚 Home Delivery'}</p>
          <p><strong>Status:</strong> <span style="color:${statusInfo.color};font-weight:bold">${order.status.toUpperCase()}</span></p>
          <p style="margin-top:15px;font-size:16px">${statusInfo.message}</p>
          
          ${order.deliveryMethod === 'pickup' && order.status === 'shipped' ? `
            <div style="background:#E0F2FE;padding:15px;border-radius:8px;margin-top:15px">
              <p style="margin:0;font-size:14px;color:#075985">
                <strong>📍 Pickup Location:</strong><br>
                Portugal Bakery<br>
                123 Main Street, Johannesburg<br>
                Mon-Sat: 7:00 AM - 6:00 PM | Sun: 8:00 AM - 2:00 PM
              </p>
            </div>
          ` : ''}
        </div>
        <p style="font-size:14px;color:#666">
          If you have any questions, feel free to reach out to us.
        </p>
        <p>Best regards,<br>Portugal Bakery Team</p>
      </div>`
    });

    console.log('✅ Order status email sent:', user.email, order.orderNumber, order.status);
  } catch (error) {
    console.error('❌ Failed to send order status email:', error);
  }
}

// 3. ADMIN MESSAGE EMAIL (sent when admin sends a message to customer)
async function sendMessageEmail(customer, order, subject, message) {
  try {
    await resend.emails.send({
      from: 'Portugal Bakery <onboarding@resend.dev>',
      to: customer.email,
      subject: `Message from Portugal Bakery - ${order.orderNumber}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#8B4513">New Message 💬</h1>
        <p>Dear ${customer.firstName},</p>
        <p>We have sent you a message regarding your order:</p>
        <div style="background:#FFF8DC;padding:20px;border-radius:10px;margin:20px 0">
          <p><strong>Order Number:</strong> ${order.orderNumber}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <div style="background:white;padding:15px;border-radius:5px;margin-top:15px;border-left:3px solid #D97706">
            <p style="margin:0;white-space:pre-wrap">${message}</p>
          </div>
        </div>
        <p style="font-size:14px;color:#666">
          You can reply to this message by contacting us directly.
        </p>
        <p>Best regards,<br>Portugal Bakery Team</p>
      </div>`
    });

    console.log('✅ Admin message email sent:', customer.email, order.orderNumber);
  } catch (error) {
    console.error('❌ Failed to send admin message email:', error);
  }
}

// Health check
app.get('/health', async (req, res) => {
  try {
    await db.admin().ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', message: error.message });
  }
});

// Auth endpoints
app.post('/api/auth/register', strictLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty()
], validate, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    if (await db.collection('users').findOne({ email })) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const user = {
      email,
      password: await bcrypt.hash(password, 10),
      firstName,
      lastName,
      phone: phone || '',
      role: 'customer',
      createdAt: new Date(),
      lastLogin: new Date()
    };

    const result = await db.collection('users').insertOne(user);
    const token = jwt.sign({ userId: result.insertedId.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ Registered:', email);

    // ✅ FIXED: Now includes createdAt
    res.json({
      token,
      user: {
        _id: result.insertedId,
        email,
        firstName,
        lastName,
        phone,
        role: 'customer',
        createdAt: user.createdAt  // ✅ ADDED THIS
      }
    });
  } catch (error) {
    handleError(res, error, 'Registration failed');
  }
});

const supportChatClients = {
  customers: new Map(), // Map<userId, Set<response>>
  admins: new Set()
};

// SSE endpoint for support chat (customers)
app.get('/api/sse/support-chat', authenticateSSE, (req, res) => {
  const userId = req.user._id.toString();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write('data: {"type":"connected","message":"Support chat SSE connected"}\n\n');

  if (!supportChatClients.customers.has(userId)) {
    supportChatClients.customers.set(userId, new Set());
  }
  supportChatClients.customers.get(userId).add(res);
  console.log('✅ Customer support chat SSE connected:', req.user.email);

  req.on('close', () => {
    const userClients = supportChatClients.customers.get(userId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        supportChatClients.customers.delete(userId);
      }
    }
    console.log('❌ Customer support chat SSE disconnected:', req.user.email);
  });
});

// SSE endpoint for admin support chat
app.get('/api/sse/admin-support', authenticateSSE, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write('data: {"type":"connected","message":"Admin support chat SSE connected"}\n\n');

  supportChatClients.admins.add(res);
  console.log('✅ Admin support chat SSE connected:', req.user.email, 'Active:', supportChatClients.admins.size);

  req.on('close', () => {
    supportChatClients.admins.delete(res);
    console.log('❌ Admin support chat SSE disconnected:', req.user.email);
  });
});

// Helper function to broadcast to specific customer in support chat
function broadcastToCustomerSupport(userId, data) {
  const userIdStr = userId.toString();
  const clients = supportChatClients.customers.get(userIdStr);

  if (!clients || clients.size === 0) {
    console.log(`📡 No support chat SSE clients for user ${userIdStr}`);
    return;
  }

  const message = `data: ${JSON.stringify(data)}\n\n`;
  let sent = 0;

  clients.forEach(client => {
    try {
      client.write(message);
      sent++;
    } catch (err) {
      console.error('Failed to send to customer support client:', err.message);
      clients.delete(client);
    }
  });

  console.log(`📡 Broadcast to ${sent} support client(s) for user ${userIdStr}:`, data.type);
}

// Helper function to broadcast to all admins in support chat
function broadcastToAdminsSupport(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  let sent = 0;

  supportChatClients.admins.forEach(client => {
    try {
      client.write(message);
      sent++;
    } catch (err) {
      console.error('Failed to send to admin support client:', err.message);
      supportChatClients.admins.delete(client);
    }
  });

  if (sent > 0) {
    console.log(`📡 Broadcast to ${sent} admin support client(s):`, data.type);
  }
}

// Get time-based greeting
function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

// Send support message (customer to admin or admin to customer)
app.post('/api/support/send', authenticateToken, [
  body('message').trim().notEmpty().isLength({ max: 5000 })
], validate, async (req, res) => {
  try {
    const { message } = req.body;
    const isAdmin = req.user.role === 'admin';

    // If customer is sending message
    if (!isAdmin) {
      // Check if this is their first message
      const existingMessages = await db.collection('support_messages').countDocuments({
        userId: req.user._id
      });

      const isFirstMessage = existingMessages === 0;

      // Create user message
      const userMessage = {
        userId: req.user._id,
        fromUserId: req.user._id,
        toUserId: null, // null means to all admins
        message,
        fromUserName: `${req.user.firstName} ${req.user.lastName}`,
        isFromAdmin: false,
        isAutoReply: false,
        createdAt: new Date()
      };

      const userResult = await db.collection('support_messages').insertOne(userMessage);
      userMessage._id = userResult.insertedId;

      // Broadcast to all admins
      broadcastToAdminsSupport({
        type: 'new_support_message',
        message: {
          ...userMessage,
          _id: userMessage._id.toString(),
          userId: userMessage.userId.toString(),
          fromUserId: userMessage.fromUserId.toString()
        }
      });

      // If first message, send auto-reply
      if (isFirstMessage) {
        const greeting = getTimeBasedGreeting();
        const autoReplyText = `${greeting} ${req.user.firstName} ${req.user.lastName}, thank you for messaging us! We will be getting back to you shortly. Feel free to explore the site whilst we get an admin to respond to your message.`;

        const autoReply = {
          userId: req.user._id,
          fromUserId: null, // null means from system/admin
          toUserId: req.user._id,
          message: autoReplyText,
          fromUserName: 'Portugal Bakery Support',
          isFromAdmin: true,
          isAutoReply: true,
          createdAt: new Date()
        };

        const autoReplyResult = await db.collection('support_messages').insertOne(autoReply);
        autoReply._id = autoReplyResult.insertedId;

        console.log('✅ Auto-reply sent to customer:', req.user.email);

        res.json({
          userMessage: {
            ...userMessage,
            _id: userMessage._id.toString(),
            userId: userMessage.userId.toString(),
            fromUserId: userMessage.fromUserId.toString()
          },
          autoReply: {
            ...autoReply,
            _id: autoReply._id.toString(),
            userId: autoReply.userId.toString(),
            toUserId: autoReply.toUserId.toString()
          }
        });
      } else {
        res.json({
          userMessage: {
            ...userMessage,
            _id: userMessage._id.toString(),
            userId: userMessage.userId.toString(),
            fromUserId: userMessage.fromUserId.toString()
          }
        });
      }

    } else {
      // Admin is sending message - needs recipientId
      const { recipientId } = req.body;

      if (!recipientId) {
        return res.status(400).json({ error: 'recipientId required for admin messages' });
      }

      const adminMessage = {
        userId: new ObjectId(recipientId),
        fromUserId: req.user._id,
        toUserId: new ObjectId(recipientId),
        message,
        fromUserName: `${req.user.firstName} ${req.user.lastName} (Admin)`,
        isFromAdmin: true,
        isAutoReply: false,
        createdAt: new Date()
      };

      const result = await db.collection('support_messages').insertOne(adminMessage);
      adminMessage._id = result.insertedId;

      // Broadcast to specific customer
      broadcastToCustomerSupport(recipientId, {
        type: 'new_support_message',
        message: {
          ...adminMessage,
          _id: adminMessage._id.toString(),
          userId: adminMessage.userId.toString(),
          fromUserId: adminMessage.fromUserId.toString(),
          toUserId: adminMessage.toUserId.toString()
        }
      });

      console.log('✅ Admin message sent to customer:', recipientId);

      res.json({
        ...adminMessage,
        _id: adminMessage._id.toString(),
        userId: adminMessage.userId.toString(),
        fromUserId: adminMessage.fromUserId.toString(),
        toUserId: adminMessage.toUserId.toString()
      });
    }
  } catch (error) {
    handleError(res, error, 'Failed to send message');
  }
});

// Get support messages for current user (customer view)
app.get('/api/support/messages', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Use /api/support/conversations for admin' });
    }

    const messages = await db.collection('support_messages')
      .find({ userId: req.user._id })
      .sort({ createdAt: 1 })
      .toArray();

    res.json(messages.map(msg => ({
      ...msg,
      _id: msg._id.toString(),
      userId: msg.userId.toString(),
      fromUserId: msg.fromUserId ? msg.fromUserId.toString() : null,
      toUserId: msg.toUserId ? msg.toUserId.toString() : null
    })));
  } catch (error) {
    handleError(res, error, 'Failed to fetch messages');
  }
});

// Get all support conversations (admin view)
app.get('/api/support/conversations', authenticateAdmin, async (req, res) => {
  try {
    // Get all unique users who have sent support messages
    const conversations = await db.collection('support_messages').aggregate([
      {
        $group: {
          _id: '$userId',
          lastMessage: { $last: '$message' },
          lastMessageTime: { $last: '$createdAt' },
          messageCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          userId: '$_id',
          userName: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
          userEmail: '$user.email',
          lastMessage: 1,
          lastMessageTime: 1,
          messageCount: 1
        }
      },
      { $sort: { lastMessageTime: -1 } }
    ]).toArray();

    res.json(conversations.map(conv => ({
      ...conv,
      userId: conv.userId.toString()
    })));
  } catch (error) {
    handleError(res, error, 'Failed to fetch conversations');
  }
});

// Get messages for specific user (admin view)
app.get('/api/support/conversation/:userId', authenticateAdmin, [
  param('userId').isMongoId()
], validate, async (req, res) => {
  try {
    const userId = new ObjectId(req.params.userId);

    const messages = await db.collection('support_messages')
      .find({ userId })
      .sort({ createdAt: 1 })
      .toArray();

    res.json(messages.map(msg => ({
      ...msg,
      _id: msg._id.toString(),
      userId: msg.userId.toString(),
      fromUserId: msg.fromUserId ? msg.fromUserId.toString() : null,
      toUserId: msg.toUserId ? msg.toUserId.toString() : null
    })));
  } catch (error) {
    handleError(res, error, 'Failed to fetch conversation');
  }
});

// ============================================
// FIX 2: LOGIN ENDPOINT (around line 232)
// ============================================
app.post('/api/auth/login', strictLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection('users').findOne({ email });

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
    const token = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });

    console.log('✅ Login:', email);

    // ✅ FIXED: Now includes createdAt
    res.json({
      token,
      user: {
        _id: user._id,
        email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt  // ✅ ADDED THIS
      }
    });
  } catch (error) {
    handleError(res, error, 'Login failed');
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/change-password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], validate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await db.collection('users').findOne({ _id: req.user._id });

    if (!await bcrypt.compare(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await db.collection('users').updateOne({ _id: req.user._id }, { $set: { password: await bcrypt.hash(newPassword, 10) } });

    console.log('✅ Password changed:', user.email);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to change password');
  }
});

app.post('/api/auth/request-password-reset', strictLimiter, [
  body('email').isEmail().normalizeEmail()
], validate, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await db.collection('users').findOne({ email });

    if (user) {
      const resetToken = jwt.sign({ userId: user._id.toString(), type: 'password-reset' }, process.env.JWT_SECRET, { expiresIn: '1h' });

      await db.collection('users').updateOne({ _id: user._id }, {
        $set: {
          resetToken: await bcrypt.hash(resetToken, 10),
          resetTokenExpires: new Date(Date.now() + 3600000)
        }
      });

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

      // ✅ CORRECT PASSWORD RESET EMAIL
      await resend.emails.send({
        from: 'Portugal Bakery <onboarding@resend.dev>',
        to: email,
        subject: 'Password Reset Request',
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h1 style="color:#8B4513">Password Reset 🔐</h1>
          <p>Hello ${user.firstName},</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${resetUrl}" style="background:#D97706;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold">Reset Password</a>
          </div>
          <p style="font-size:12px;color:#666">This link will expire in 1 hour.</p>
          <p style="font-size:12px;color:#666">If you didn't request this, please ignore this email.</p>
          <p style="font-size:12px;color:#666;margin-top:20px">Or copy this link:<br>${resetUrl}</p>
          <p>Best regards,<br>Portugal Bakery Team</p>
        </div>`
      });

      console.log('✅ Reset email sent via Resend:', email);
    }

    res.status(200).json({ message: 'If account exists, reset link sent' });
  } catch (error) {
    console.error('Reset request error:', error);
    handleError(res, error, 'Failed to process request');
  }
});

app.post('/api/auth/verify-reset-token', [body('token').notEmpty()], validate, async (req, res) => {
  try {
    const decoded = jwt.verify(req.body.token, process.env.JWT_SECRET);
    if (decoded.type !== 'password-reset') return res.status(400).json({ error: 'Invalid token type' });

    const user = await db.collection('users').findOne({
      _id: new ObjectId(decoded.userId),
      resetTokenExpires: { $gt: new Date() }
    });

    if (!user || !user.resetToken) return res.status(400).json({ error: 'Invalid or expired token' });

    res.json({ valid: true, email: user.email });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

app.post('/api/auth/reset-password', strictLimiter, [
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], validate, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'password-reset') return res.status(400).json({ error: 'Invalid token' });

    const user = await db.collection('users').findOne({
      _id: new ObjectId(decoded.userId),
      resetTokenExpires: { $gt: new Date() }
    });

    if (!user || !user.resetToken) return res.status(400).json({ error: 'Invalid or expired token' });

    await db.collection('users').updateOne({ _id: user._id }, {
      $set: { password: await bcrypt.hash(newPassword, 10) },
      $unset: { resetToken: "", resetTokenExpires: "" }
    });

    console.log('✅ Password reset successful:', user.email);
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    handleError(res, error, 'Failed to reset password');
  }
});

// ==================== CART ENDPOINTS ====================

// Get current user's cart
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    let cart = await db.collection('carts').findOne({ userId: req.user._id });

    if (!cart) {
      cart = { userId: req.user._id, items: [], updatedAt: new Date() };
      await db.collection('carts').insertOne(cart);
    }

    res.json(cart.items);
  } catch (error) {
    handleError(res, error, 'Failed to retrieve cart');
  }
});


// Save/update cart
app.post('/api/cart', authenticateToken, async (req, res) => {
  try {
    const items = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Cart must be an array' });
    }

    const sanitizedItems = items.map(i => ({
      id: Number(i.id),
      name: String(i.name),
      price: Number(i.price),
      imageUrl: String(i.imageUrl),
      quantity: Number(i.quantity)
    }));

    await db.collection('carts').updateOne(
      { userId: req.user._id },
      {
        $set: {
          items: sanitizedItems,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json(sanitizedItems); // VERY IMPORTANT — return array only
  } catch (error) {
    handleError(res, error, 'Failed to update cart');
  }
});


// Clear cart
app.delete('/api/cart', authenticateToken, async (req, res) => {
  try {
    await db.collection('carts').updateOne(
      { userId: req.user._id },
      { $set: { items: [], updatedAt: new Date() } },
      { upsert: true }
    );

    res.json([]);
  } catch (error) {
    handleError(res, error, 'Failed to clear cart');
  }
});


// ==================== ORDER ENDPOINTS ====================

app.post('/api/orders', authenticateToken, [
  body('items').isArray({ min: 1 }),
  body('totalAmount').isFloat({ min: 0 }),
  body('customerPhone').trim().notEmpty(),
  body('deliveryMethod').isIn(['delivery', 'pickup']), // ✅ ADDED
  // Only require address if delivery method is 'delivery'
  body('customerAddress').custom((value, { req }) => {
    if (req.body.deliveryMethod === 'delivery' && !value?.trim()) {
      throw new Error('Delivery address is required for delivery orders');
    }
    return true;
  })
], validate, async (req, res) => {
  try {
    const {
      items,
      totalAmount,
      shippingAddress,
      specialInstructions,
      customerPhone,
      customerAddress,
      deliveryMethod  // ✅ ADDED
    } = req.body;

    const calculated = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    if (Math.abs(calculated - totalAmount) > 0.01) {
      return res.status(400).json({ error: 'Total mismatch' });
    }

    const order = {
      userId: req.user._id,
      orderNumber: generateOrderNumber(),
      status: 'pending',
      paymentStatus: 'pending',
      items,
      totalAmount,
      phone: customerPhone,
      address: deliveryMethod === 'delivery' ? customerAddress : '',
      deliveryMethod,
      deliveryFee: req.body.deliveryFee || 0,  // ✅ ADD THIS
      deliveryZone: req.body.deliveryZone || '',  // ✅ ADD THIS
      shippingAddress: shippingAddress || customerAddress,
      specialInstructions: specialInstructions || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('orders').insertOne(order);
    order._id = result.insertedId;

    // Clear cart after order
    await db.collection('carts').updateOne(
      { userId: req.user._id },
      { $set: { items: [], updatedAt: new Date() } },
      { upsert: true }
    );

    // Send email
    sendOrderConfirmationEmail(order).catch(e =>
      console.error('Email error:', e)
    );

    // Broadcast to all admins
    broadcastToAdmins({
      type: 'new_order',
      order: {
        ...order,
        _id: order._id.toString(),
        userId: order.userId.toString(),
        user: [{
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          email: req.user.email
        }]
      }
    });

    console.log('✅ Order created:', order.orderNumber, '- Method:', deliveryMethod);
    res.json(order);
  } catch (error) {
    handleError(res, error, 'Order creation failed');
  }
});

// ==================== ORDER STATUS UPDATE ENDPOINT ====================

app.put('/api/orders/:orderNumber/status',
  authenticateAdmin,
  [
    param('orderNumber').matches(/^PB-[A-Z0-9]{8}-[A-Z0-9]{4}$/),
    body('status').isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('❌ Validation errors:', errors.array());
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  },
  async (req, res) => {
    try {
      const { orderNumber } = req.params;
      const { status } = req.body;

      console.log('\n╔════════════════════════════════════════════════╗');
      console.log('║  ORDER STATUS UPDATE REQUEST                   ║');
      console.log('╚════════════════════════════════════════════════╝');
      console.log('📦 Order Number:', orderNumber);
      console.log('🔄 New Status:', status);
      console.log('👤 Admin:', req.user.email);
      console.log('⏰ Timestamp:', new Date().toISOString());

      // ✅ STEP 1: Verify order exists
      console.log('\n[STEP 1] Searching for order in database...');
      const existingOrder = await db.collection('orders').findOne({
        orderNumber: orderNumber
      });

      if (!existingOrder) {
        console.error('❌ Order not found in database');
        console.error('   Searched for orderNumber:', orderNumber);

        // Debug: List all order numbers in database
        const allOrders = await db.collection('orders')
          .find({}, { projection: { orderNumber: 1 } })
          .limit(10)
          .toArray();
        console.error('   Available orders:', allOrders.map(o => o.orderNumber));

        return res.status(404).json({
          error: 'Order not found',
          orderNumber: orderNumber,
          hint: 'Check if order number format is correct'
        });
      }

      console.log('✅ Order found!');
      console.log('   ID:', existingOrder._id);
      console.log('   Current Status:', existingOrder.status);
      console.log('   Customer ID:', existingOrder.userId);

      // ✅ STEP 2: Perform the update
      console.log('\n[STEP 2] Updating order status...');
      const updateResult = await db.collection('orders').updateOne(
        { orderNumber: orderNumber },
        {
          $set: {
            status: status,
            updatedAt: new Date()
          }
        }
      );

      console.log('📝 Update Result:');
      console.log('   Matched:', updateResult.matchedCount);
      console.log('   Modified:', updateResult.modifiedCount);

      if (updateResult.matchedCount === 0) {
        console.error('❌ No documents matched - this should not happen!');
        return res.status(500).json({
          error: 'Update failed - order not matched'
        });
      }

      if (updateResult.modifiedCount === 0) {
        console.warn('⚠️ No modifications made - status might already be', status);
      } else {
        console.log('✅ Order updated successfully!');
      }

      // ✅ STEP 3: Fetch the updated order
      console.log('\n[STEP 3] Fetching updated order...');
      const updatedOrder = await db.collection('orders').findOne({
        orderNumber: orderNumber
      });

      if (!updatedOrder) {
        console.error('❌ Failed to retrieve updated order');
        return res.status(500).json({
          error: 'Update succeeded but failed to retrieve updated order'
        });
      }

      console.log('✅ Retrieved updated order');
      console.log('   New Status:', updatedOrder.status);
      console.log('   Updated At:', updatedOrder.updatedAt);

      // ✅ STEP 4: Send email notification (non-blocking)
      console.log('\n[STEP 4] Sending email notification...');
      sendOrderStatusEmail(updatedOrder)
        .then(() => console.log('✅ Email sent successfully'))
        .catch(e => console.error('⚠️ Email failed:', e.message));

      // ✅ STEP 5: BROADCAST TO CUSTOMER VIA SSE (NEW!)
      console.log('\n[STEP 5] Broadcasting status change to customer via SSE...');
      broadcastToCustomer(updatedOrder.userId, {
        type: 'order_status_changed',
        order: {
          orderNumber: updatedOrder.orderNumber,
          status: updatedOrder.status,
          updatedAt: updatedOrder.updatedAt
        }
      });

      // ✅ STEP 6: Prepare and send response
      console.log('\n[STEP 6] Preparing response...');
      const responseOrder = {
        ...updatedOrder,
        _id: updatedOrder._id.toString(),
        userId: updatedOrder.userId.toString()
      };

      console.log('✅ Sending 200 OK response');
      console.log('═══════════════════════════════════════════════\n');

      res.status(200).json(responseOrder);

    } catch (error) {
      console.error('\n╔════════════════════════════════════════════════╗');
      console.error('║  ERROR IN STATUS UPDATE                       ║');
      console.error('╚════════════════════════════════════════════════╝');
      console.error('❌ Error:', error.message);
      console.error('📚 Stack:', error.stack);
      console.error('═══════════════════════════════════════════════\n');

      // Provide detailed error info
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.message
        });
      }

      res.status(500).json({
        error: 'Failed to update order status',
        message: error.message,
        orderNumber: req.params.orderNumber
      });
    }
  }
);

const sseClients = {
  admin: new Set(),
  customers: new Map() // Map<userId, Set<response>>
};

// Special SSE authentication that accepts token from query or header


// SSE endpoint for admins
app.get('/api/sse/admin', authenticateSSE, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write('data: {"type":"connected","message":"Admin SSE connected"}\n\n');

  sseClients.admin.add(res);
  console.log('✅ Admin SSE connected:', req.user.email, 'Active:', sseClients.admin.size);

  req.on('close', () => {
    sseClients.admin.delete(res);
    console.log('❌ Admin SSE disconnected:', req.user.email);
  });
});

// SSE endpoint for customers
app.get('/api/sse/customer', authenticateSSE, (req, res) => {
  const userId = req.user._id.toString();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write('data: {"type":"connected","message":"Customer SSE connected"}\n\n');

  if (!sseClients.customers.has(userId)) {
    sseClients.customers.set(userId, new Set());
  }
  sseClients.customers.get(userId).add(res);
  console.log('✅ Customer SSE connected:', req.user.email);

  req.on('close', () => {
    const userClients = sseClients.customers.get(userId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        sseClients.customers.delete(userId);
      }
    }
    console.log('❌ Customer SSE disconnected:', req.user.email);
  });
});

// SSE endpoint for customers (get notified of order status changes)
// app.get('/api/sse/customer', authenticateToken, (req, res) => {
//   const userId = req.user._id.toString();

//   // Set SSE headers
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');
//   res.setHeader('X-Accel-Buffering', 'no');

//   // Send initial connection message
//   res.write('data: {"type":"connected","message":"Customer SSE connected"}\n\n');

//   // Add this client to customer clients
//   if (!sseClients.customers.has(userId)) {
//     sseClients.customers.set(userId, new Set());
//   }
//   sseClients.customers.get(userId).add(res);
//   console.log('✅ Customer SSE connected:', req.user.email);

//   // Cleanup on disconnect
//   req.on('close', () => {
//     const userClients = sseClients.customers.get(userId);
//     if (userClients) {
//       userClients.delete(res);
//       if (userClients.size === 0) {
//         sseClients.customers.delete(userId);
//       }
//     }
//     console.log('❌ Customer SSE disconnected:', req.user.email);
//   });
// });

// Helper function to broadcast to all admin clients
function broadcastToAdmins(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  let sent = 0;

  sseClients.admin.forEach(client => {
    try {
      client.write(message);
      sent++;
    } catch (err) {
      console.error('Failed to send to admin client:', err.message);
      sseClients.admin.delete(client);
    }
  });

  if (sent > 0) {
    console.log(`📡 Broadcast to ${sent} admin(s):`, data.type);
  }
}

// Helper function to broadcast to specific customer
function broadcastToCustomer(userId, data) {
  const userIdStr = userId.toString();
  const clients = sseClients.customers.get(userIdStr);

  if (!clients || clients.size === 0) {
    console.log(`📡 No SSE clients for user ${userIdStr}`);
    return;
  }

  const message = `data: ${JSON.stringify(data)}\n\n`;
  let sent = 0;

  clients.forEach(client => {
    try {
      client.write(message);
      sent++;
    } catch (err) {
      console.error('Failed to send to customer client:', err.message);
      clients.delete(client);
    }
  });

  console.log(`📡 Broadcast to ${sent} client(s) for user ${userIdStr}:`, data.type);
}

// Get all orders (Admin only) with user details
app.get('/api/orders', authenticateAdmin, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const filter = status ? { status } : {};

    // Aggregate to join with users collection
    const orders = await db.collection('orders').aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'  // ✅ Use 'user' not 'userId'
        }
      },
      // ✅ REMOVED $unwind - keep user as an array
      { $sort: { createdAt: -1 } },
      { $skip: +offset },
      { $limit: +limit },
      {
        $project: {
          'user.password': 0,
          'user.resetToken': 0,
          'user.resetTokenExpires': 0
        }
      }
    ]).toArray();

    console.log('📦 Fetched orders:', orders.length);

    // Return as direct array, not wrapped in object
    res.json(orders);
  } catch (error) {
    console.error('❌ Orders fetch error:', error);
    handleError(res, error, 'Failed to fetch orders');
  }
});

// Get orders for the currently logged-in user
app.get('/api/orders/my-orders', authenticateToken, async (req, res) => {
  try {
    const orders = await db.collection('orders')
      .find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(orders);
  } catch (error) {
    handleError(res, error, 'Failed to fetch orders');
  }
});

// Get single order by order number
app.get('/api/orders/:orderNumber', authenticateToken, async (req, res) => {
  try {
    const order = await db.collection('orders').findOne({ orderNumber: req.params.orderNumber });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check authorization: admin can see all orders, customers only their own
    if (req.user.role !== 'admin' && order.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // ✅ BROADCAST TO ALL ADMINS - NEW ORDER
    broadcastToAdmins({
      type: 'new_order',
      order: {
        ...order,
        _id: order._id.toString(),
        userId: order.userId.toString(),
        user: [{
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          email: req.user.email
        }]
      }
    });

    res.json(order);
  } catch (error) {
    handleError(res, error, 'Failed to retrieve order');
  }
});

// ==================== PRODUCT ENDPOINTS ====================
// GET all products
app.get('/api/products', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = {};

    if (category && category !== 'All') {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const products = await db.collection('products')
      .find(query)
      .sort({ id: 1 })
      .toArray();

    // Serialize all products
    const serializedProducts = products.map(serializeProduct);

    console.log('📦 Fetched products:', serializedProducts.length);
    res.json(serializedProducts);
  } catch (error) {
    console.error('❌ Products fetch error:', error);
    handleError(res, error, 'Failed to fetch products');
  }
});

// Seed products
app.post('/api/products/seed', /* authenticateAdmin, */ async (req, res) => {
  try {
    const products = req.body;
    if (!Array.isArray(products)) return res.status(400).json({ error: 'Products must be an array' });

    const count = await db.collection('products').countDocuments();
    if (count > 0) return res.status(400).json({ error: 'Products already seeded. Use update endpoints instead.' });

    const productsToInsert = products.map(p => ({
      ...p,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const result = await db.collection('products').insertMany(productsToInsert);

    console.log('✅ Seeded', result.insertedCount, 'products');
    res.json({ message: `Successfully seeded ${result.insertedCount} products`, count: result.insertedCount });
  } catch (error) {
    handleError(res, error, 'Failed to seed products');
  }
});

// Add new product
app.post('/api/products', /* authenticateAdmin, */ validate, async (req, res) => {
  try {
    const { name, category, price, image, description, ingredients, weight, allergens, nutritionalInfo } = req.body;

    const lastProduct = await db.collection('products').find({}).sort({ id: -1 }).limit(1).toArray();
    const nextId = lastProduct.length > 0 ? lastProduct[0].id + 1 : 1;

    const product = {
      id: nextId,
      name,
      category,
      price,
      image,
      description,
      ingredients,
      weight,
      allergens,
      nutritionalInfo: nutritionalInfo || { calories: 0, protein: "0g", carbs: "0g", fat: "0g" },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('products').insertOne(product);
    product._id = result.insertedId.toString();

    console.log('✅ Product added:', name, 'ID:', nextId);
    res.json(product);
  } catch (error) {
    handleError(res, error, 'Failed to add product');
  }
});

// Get single product by ID (supports numeric id or Mongo _id)
app.get('/api/products/:id', validateProductId, validate, async (req, res) => {
  try {
    const paramId = req.params.id;
    let product;

    if (ObjectId.isValid(paramId) && paramId.length === 24) {
      product = await db.collection('products').findOne({ _id: new ObjectId(paramId) });
    }
    if (!product && !isNaN(Number(paramId))) {
      product = await db.collection('products').findOne({ id: Number(paramId) });
    }

    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(serializeProduct(product));
  } catch (error) {
    handleError(res, error, 'Failed to retrieve product');
  }
});

// Update product - FIXED VERSION
app.put('/api/products/:id', validateProductId, validate, async (req, res) => {
  try {
    const paramId = req.params.id;
    const updates = { ...req.body };

    console.log('📝 PUT /api/products/' + paramId + ' - Request received');

    // Remove fields that shouldn't be updated
    delete updates._id;
    delete updates.id;
    delete updates.createdAt;
    updates.updatedAt = new Date();

    let query;

    // Try numeric id first (most common)
    if (!isNaN(Number(paramId)) && Number(paramId) > 0) {
      query = { id: Number(paramId) };
    }
    // Fall back to MongoDB _id
    else if (ObjectId.isValid(paramId) && paramId.length === 24) {
      query = { _id: new ObjectId(paramId) };
    }
    else {
      console.error('❌ Invalid ID format:', paramId);
      return res.status(400).json({ error: 'Invalid product ID format' });
    }

    // Check if product exists
    const existingProduct = await db.collection('products').findOne(query);
    if (!existingProduct) {
      console.error('❌ Product not found. Query:', query);
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log('✅ Found:', existingProduct.name, '(ID:', existingProduct.id + ')');

    // Perform update
    const result = await db.collection('products').findOneAndUpdate(
      query,
      { $set: updates },
      { returnDocument: 'after' }
    );

    // ✅ FIX: Handle both possible return structures
    const updatedProduct = result.value || result;

    if (!updatedProduct) {
      console.error('❌ Update returned null');
      return res.status(500).json({ error: 'Update failed' });
    }

    console.log('✅ Updated successfully:', updatedProduct.name);

    // Serialize and return
    res.json(serializeProduct(updatedProduct));
  } catch (error) {
    console.error('❌ Update error:', error.message);
    handleError(res, error, 'Failed to update product');
  }
});

// Delete product - FIXED VERSION
app.delete('/api/products/:id', /* authenticateAdmin, */ validateProductId, validate, async (req, res) => {
  try {
    const paramId = req.params.id;
    console.log('🗑️ DELETE request for product ID:', paramId);

    let query;

    // Try numeric id first (most common)
    if (!isNaN(Number(paramId)) && Number(paramId) > 0) {
      query = { id: Number(paramId) };
      console.log('🔍 Delete query: { id:', Number(paramId), '}');
    }
    // Fall back to MongoDB _id
    else if (ObjectId.isValid(paramId) && paramId.length === 24) {
      query = { _id: new ObjectId(paramId) };
      console.log('🔍 Delete query: { _id: ObjectId("' + paramId + '") }');
    }
    else {
      console.error('❌ Invalid product ID format:', paramId);
      return res.status(400).json({ error: 'Invalid product ID format' });
    }

    // Check if product exists first
    const existingProduct = await db.collection('products').findOne(query);
    if (!existingProduct) {
      console.error('❌ Product not found for deletion. Query:', query);
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log('✅ Found product to delete:', existingProduct.name, '(ID:', existingProduct.id + ')');

    // Perform deletion
    const result = await db.collection('products').deleteOne(query);

    if (result.deletedCount === 0) {
      console.error('❌ Delete operation failed - no documents deleted');
      return res.status(500).json({ error: 'Failed to delete product' });
    }

    console.log('✅ Product deleted successfully:', existingProduct.name, 'ID:', existingProduct.id);

    res.json({
      message: 'Product deleted successfully',
      product: serializeProduct(existingProduct)
    });
  } catch (error) {
    console.error('❌ Delete error:', error.message);
    console.error('Stack:', error.stack);
    handleError(res, error, 'Failed to delete product');
  }
});

// Messaging
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
      orderId: order._id,
      orderNumber: order.orderNumber,
      fromUserId: req.user._id,
      toUserId: customer._id,
      subject,
      message,
      isRead: false,
      emailSent: false,
      createdAt: new Date()
    };

    const result = await db.collection('messages').insertOne(msg);

    sendMessageEmail(customer, order, subject, message)
      .then(() => db.collection('messages').updateOne({ _id: result.insertedId }, { $set: { emailSent: true } }))
      .catch(e => console.error('Email error:', e));

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
        { $set: { isRead: true } }
      );
    }

    res.json(messages);
  } catch (error) {
    handleError(res, error, 'Failed to retrieve messages');
  }
});

app.get('/api/messages/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await db.collection('messages').countDocuments({ toUserId: req.user._id, isRead: false });
    res.json({ count });
  } catch (error) {
    handleError(res, error, 'Failed');
  }
});

// Error handling
app.use((req, res) => {
  console.log('❌ 404:', req.method, req.path);
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const shutdown = async () => {
  console.log('🔄 Shutting down...');
  if (mongoClient) await mongoClient.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const startServer = async () => {
  try {
    await connectDB();
    await initDatabase();

    app.listen(PORT, () => {
      console.log('🚀 Server running on port', PORT);
      console.log('🔗 Frontend:', process.env.FRONTEND_URL);
    });
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;