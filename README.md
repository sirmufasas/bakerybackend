# Portugal Bakery Backend

Deploy this backend on Render.com to power your bakery's order system.

## Setup on Render

1. **Create a new Web Service** on Render
2. **Connect your repository** or upload these files
3. **Set the following:**
   - Build Command: `npm install`
   - Start Command: `npm start`

4. **Add Environment Variables:**
   - `STRIPE_SECRET_KEY` - Your Stripe secret key (from https://dashboard.stripe.com/apikeys)
   - `STRIPE_WEBHOOK_SECRET` - Webhook signing secret (from Stripe dashboard)
   - `RESEND_API_KEY` - Your Resend API key (from https://resend.com/api-keys)
   - `FRONTEND_URL` - Your frontend URL (e.g., https://your-app.lovable.app)
   - `ADMIN_EMAIL` - Admin email for notifications
   - `DATABASE_URL` - PostgreSQL connection string (Render provides this automatically)

5. **Create a PostgreSQL Database** on Render and link it to your web service

## API Endpoints

### Payments
- `POST /api/payments/create-intent` - Create Stripe payment intent
- `POST /api/payments/confirm` - Confirm payment
- `POST /api/webhooks/stripe` - Stripe webhook handler

### Orders
- `POST /api/orders` - Create new order
- `GET /api/orders/:orderId` - Get order by ID
- `GET /api/orders` - Get all orders (admin)
- `PUT /api/orders/:orderId/status` - Update order status

### Messages
- `POST /api/messages` - Send message
- `GET /api/messages/:orderId` - Get messages for order

### Health
- `GET /health` - Health check

## Local Development

1. Copy `.env.example` to `.env` and fill in your values
2. Run `npm install`
3. Run `npm run dev`

## Stripe Setup

1. Create a Stripe account at https://stripe.com
2. Get your API keys from the Dashboard
3. For webhooks, add endpoint: `https://your-render-url.onrender.com/api/webhooks/stripe`
4. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`

## Resend Setup

1. Create account at https://resend.com
2. Verify your domain at https://resend.com/domains
3. Create API key at https://resend.com/api-keys
4. Update the "from" email addresses in server.js to use your verified domain
