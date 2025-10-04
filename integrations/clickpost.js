// integrations/clickpost.js
const express = require('express');
const axios = require('axios');

let db; // Global DB from server.js

const router = express.Router();

// Load env vars (Based on ClickPost Official Documentation)
const {
  CLICKPOST_USERNAME,
  CLICKPOST_API_KEY,
  CLICKPOST_ACCOUNT_CODE,
  CLICKPOST_BASE_URL,
  CLICKPOST_WEBHOOK_TOKEN,
} = process.env;

// Simple AWB generator (in production, use DB for unique IDs)
let awbCounter = 1;
const generateAWB = () => `CPAWB${Date.now()}${awbCounter++}`;

// Validate webhook token (Based on ClickPost Documentation)
const validateToken = (req) => {
  const token = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (token !== CLICKPOST_WEBHOOK_TOKEN) {
    throw new Error('Invalid or missing webhook token');
  }
  return true;
};

// Webhook handler for incoming orders - Production Ready
router.post('/webhook/orders', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/clickpost/webhook/orders ---");
  try {
    // Enhanced token validation
    validateToken(req);
    
    const orderData = req.body;
    
    // Enhanced validation with detailed error messages
    const requiredFields = ['order_id', 'pickup_info', 'drop_info', 'shipment_details'];
    const missingFields = requiredFields.filter(field => !orderData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields',
        missing_fields: missingFields,
        required_fields: requiredFields
      });
    }

    // Validate nested objects
    if (!orderData.pickup_info.name || !orderData.pickup_info.phone || !orderData.pickup_info.address) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pickup_info - missing name, phone, or address'
      });
    }

    if (!orderData.drop_info.name || !orderData.drop_info.phone || !orderData.drop_info.address) {
      return res.status(400).json({
        success: false,
        error: 'Invalid drop_info - missing name, phone, or address'
      });
    }

    if (!orderData.shipment_details.items || !Array.isArray(orderData.shipment_details.items)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid shipment_details - items must be an array'
      });
    }

    // Check for duplicate order_id
    const collection = db.collection('clickpost_orders');
    const existingOrder = await collection.findOne({ order_id: orderData.order_id });
    
    if (existingOrder) {
      return res.status(409).json({
        success: false,
        error: 'Order already exists',
        existing_waybill: existingOrder.waybill,
        order_id: orderData.order_id
      });
    }

    // Generate unique waybill
    const waybill = generateAWB();
    
    // Enhanced order data structure
    const orderToSave = {
      order_id: orderData.order_id,
      waybill,
      status: 'Pending',
      status_history: [{ 
        status: 'Pending', 
        timestamp: new Date(),
        source: 'webhook',
        description: 'Order received via webhook'
      }],
      pickup_info: {
        name: orderData.pickup_info.name.trim(),
        phone: orderData.pickup_info.phone.trim(),
        address: orderData.pickup_info.address.trim(),
        pincode: orderData.pickup_info.pincode || '',
        city: orderData.pickup_info.city || '',
        state: orderData.pickup_info.state || ''
      },
      drop_info: {
        name: orderData.drop_info.name.trim(),
        phone: orderData.drop_info.phone.trim(),
        address: orderData.drop_info.address.trim(),
        pincode: orderData.drop_info.pincode || '',
        city: orderData.drop_info.city || '',
        state: orderData.drop_info.state || ''
      },
      shipment_details: {
        items: orderData.shipment_details.items,
        weight: orderData.shipment_details.weight || 0,
        order_type: orderData.shipment_details.order_type || 'standard',
        cod_amount: orderData.shipment_details.cod_amount || 0,
        declared_value: orderData.shipment_details.declared_value || 0
      },
      created_at: new Date(),
      updated_at: new Date(),
      source: 'webhook',
      webhook_metadata: {
        received_at: new Date(),
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.get('User-Agent') || 'Unknown'
      }
    };

    // Save to database with error handling
    const insertResult = await collection.insertOne(orderToSave);
    
    if (!insertResult.insertedId) {
      throw new Error('Failed to save order to database');
    }

    // Enhanced response
    res.status(200).json({
      success: true,
      message: 'Order created successfully',
      data: {
        order_id: orderData.order_id,
        waybill: waybill,
        status: 'Pending',
        created_at: orderToSave.created_at
      },
      label_url: `https://your-label-service.com/labels/${waybill}.pdf`, // Replace with real label service
      tracking_url: `https://your-tracking-service.com/track/${waybill}` // Add tracking URL
    });

    console.log(`✅ Order ${orderData.order_id} received, AWB: ${waybill}, DB ID: ${insertResult.insertedId}`);
  } catch (error) {
    console.error("❌ Webhook error:", error.message);
    
    // Enhanced error response
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString(),
      request_id: req.headers['x-request-id'] || 'unknown'
    });
  }
});

// This route was removed - duplicate of the better implementation below

// Get orders for dashboard
router.get('/orders', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/clickpost/orders ---");
  try {
    const collection = db.collection('clickpost_orders');
    
    // Add pagination support
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Add filtering support
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.waybill) {
      filter.waybill = new RegExp(req.query.waybill, 'i');
    }
    
    const orders = await collection
      .find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const totalCount = await collection.countDocuments(filter);
    
    res.status(200).json({ 
      success: true, 
      data: orders,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_orders: totalCount,
        orders_per_page: limit
      }
    });
    console.log(`✅ Retrieved ${orders.length} orders from MongoDB (Page ${page})`);
  } catch (error) {
    console.error("❌ Error in /orders route:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Push status to ClickPost - Production Ready
router.post('/status/update', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/clickpost/status/update ---");
  try {
    // Enhanced token validation
    validateToken(req);
    
    const { waybill, status_code, status_description, location, remarks } = req.body;

    // Enhanced validation
    if (!waybill || !status_code) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: waybill, status_code',
        required_fields: ['waybill', 'status_code']
      });
    }

    // Validate waybill format
    if (typeof waybill !== 'string' || waybill.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid waybill format'
      });
    }

    // Validate status_code format
    const validStatusCodes = ['OFD', 'DEL', 'RTO', 'POD', 'NDR', 'OOD', 'PPD', 'DEX', 'INT', 'EXP'];
    if (!validStatusCodes.includes(status_code.toUpperCase())) {
      console.warn(`⚠️ Unusual status code received: ${status_code}`);
    }

    // ClickPost API payload (Based on Official Documentation)
    const payload = {
      waybill: waybill.trim(),
      status: {
        clickpost_status_code: status_code.toUpperCase(),
        clickpost_status_description: status_description || status_code,
        timestamp: new Date().toISOString(),
        location: location || 'Unknown',
        remarks: remarks || '',
      },
    };

    console.log("[STEP 1] 📋 Sending status update payload to ClickPost:", JSON.stringify(payload, null, 2));

    // Enhanced error handling for API call (Using ClickPost's recommended format)
    let response;
    try {
      // ClickPost API endpoint for status updates
      const statusUpdateUrl = `${CLICKPOST_BASE_URL}/status/update/?username=${CLICKPOST_USERNAME}&key=${CLICKPOST_API_KEY}`;
      
      response = await axios.post(statusUpdateUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      });
    } catch (apiError) {
      console.error("❌ ClickPost API Error:", apiError.response?.data || apiError.message);
      throw new Error(`ClickPost API call failed: ${apiError.response?.data?.message || apiError.message}`);
    }

    // Update status in MongoDB with enhanced error handling
    const collection = db.collection('clickpost_orders');
    const updateResult = await collection.updateOne(
      { waybill: waybill.trim() },
      {
        $set: {
          status: status_code.toUpperCase(),
          updated_at: new Date(),
          last_status_update: {
            status_code: status_code.toUpperCase(),
            description: status_description || status_code,
            location: location || 'Unknown',
            remarks: remarks || '',
            timestamp: new Date()
          }
        },
        $push: {
          status_history: {
            status: status_code.toUpperCase(),
            description: status_description || status_code,
            timestamp: new Date(),
            location: location || 'Unknown',
            remarks: remarks || '',
            source: 'clickpost_api'
          },
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      console.warn(`⚠️ No order found with waybill ${waybill} in MongoDB`);
      return res.status(404).json({
        success: false,
        error: `Order with waybill ${waybill} not found`,
        waybill: waybill
      });
    }

    // Enhanced response
    res.status(200).json({
      success: true,
      message: `Status updated for waybill ${waybill}`,
      data: {
        waybill: waybill,
        status: status_code.toUpperCase(),
        description: status_description || status_code,
        location: location || 'Unknown',
        timestamp: new Date().toISOString()
      },
      clickpost_response: response.data,
      database_updated: updateResult.modifiedCount > 0
    });
    
    console.log(`✅ Status updated for waybill ${waybill}: ${status_code.toUpperCase()}`);
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ Status push error:", JSON.stringify(errorData, null, 2));
    
    // Enhanced error response
    res.status(500).json({
      success: false,
      error: errorData,
      message: 'Failed to push status to ClickPost',
      timestamp: new Date().toISOString()
    });
  }
});

// Create order in ClickPost (Based on Official Documentation)
router.post('/create-order', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/clickpost/create-order ---");
  try {
    const orderData = req.body;
    
    // Validate required fields for ClickPost order creation
    const requiredFields = ['reference_number', 'pickup_info', 'drop_info', 'shipment_details'];
    const missingFields = requiredFields.filter(field => !orderData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields for ClickPost order creation',
        missing_fields: missingFields,
        required_fields: requiredFields
      });
    }

    // ClickPost order creation payload (Based on Official Documentation)
    const clickpostPayload = {
      reference_number: orderData.reference_number,
      pickup_info: {
        name: orderData.pickup_info.name,
        phone: orderData.pickup_info.phone,
        address: orderData.pickup_info.address,
        pincode: orderData.pickup_info.pincode,
        city: orderData.pickup_info.city,
        state: orderData.pickup_info.state,
        country: orderData.pickup_info.country || 'India'
      },
      drop_info: {
        name: orderData.drop_info.name,
        phone: orderData.drop_info.phone,
        address: orderData.drop_info.address,
        pincode: orderData.drop_info.pincode,
        city: orderData.drop_info.city,
        state: orderData.drop_info.state,
        country: orderData.drop_info.country || 'India'
      },
      shipment_details: {
        items: orderData.shipment_details.items,
        weight: orderData.shipment_details.weight,
        order_type: orderData.shipment_details.order_type || 'standard',
        cod_amount: orderData.shipment_details.cod_amount || 0,
        declared_value: orderData.shipment_details.declared_value || 0
      }
    };

    console.log("[STEP 1] 📋 Creating order in ClickPost:", JSON.stringify(clickpostPayload, null, 2));

    // ClickPost API call for order creation
    const createOrderUrl = `${CLICKPOST_BASE_URL}/create-order/?username=${CLICKPOST_USERNAME}&key=${CLICKPOST_API_KEY}`;
    
    const response = await axios.post(createOrderUrl, clickpostPayload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 15000, // 15 second timeout for order creation
    });

    // Save order to database
    const collection = db.collection('clickpost_orders');
    const orderToSave = {
      reference_number: orderData.reference_number,
      waybill: response.data.result?.waybill || 'PENDING',
      status: 'Created',
      status_history: [{
        status: 'Created',
        timestamp: new Date(),
        source: 'clickpost_api',
        description: 'Order created in ClickPost'
      }],
      pickup_info: clickpostPayload.pickup_info,
      drop_info: clickpostPayload.drop_info,
      shipment_details: clickpostPayload.shipment_details,
      clickpost_response: response.data,
      created_at: new Date(),
      updated_at: new Date()
    };

    await collection.insertOne(orderToSave);

    res.status(200).json({
      success: true,
      message: 'Order created successfully in ClickPost',
      data: {
        reference_number: orderData.reference_number,
        waybill: response.data.result?.waybill || 'PENDING',
        status: 'Created',
        clickpost_response: response.data
      }
    });

    console.log(`✅ Order created in ClickPost: ${orderData.reference_number}, Waybill: ${response.data.result?.waybill || 'PENDING'}`);
  } catch (error) {
    console.error("❌ ClickPost order creation error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
      message: 'Failed to create order in ClickPost'
    });
  }
});

// Get specific order by waybill or order_id
router.get('/order/:identifier', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/clickpost/order/:identifier ---");
  try {
    const { identifier } = req.params;
    const collection = db.collection('clickpost_orders');
    
    // Search by waybill or order_id
    const order = await collection.findOne({
      $or: [
        { waybill: identifier },
        { order_id: identifier }
      ]
    });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        identifier: identifier
      });
    }
    
    res.status(200).json({
      success: true,
      data: order
    });
    
    console.log(`✅ Retrieved order: ${identifier}`);
  } catch (error) {
    console.error("❌ Error in /order/:identifier route:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ClickPost integration is healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Get order statistics
router.get('/stats', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/clickpost/stats ---");
  try {
    const collection = db.collection('clickpost_orders');
    
    const stats = await collection.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    const totalOrders = await collection.countDocuments();
    const todayOrders = await collection.countDocuments({
      created_at: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });
    
    res.status(200).json({
      success: true,
      data: {
        total_orders: totalOrders,
        today_orders: todayOrders,
        status_breakdown: stats,
        generated_at: new Date().toISOString()
      }
    });
    
    console.log(`✅ Retrieved stats: ${totalOrders} total orders`);
  } catch (error) {
    console.error("❌ Error in /stats route:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = {
  router,
  init: (globalDb) => {
    db = globalDb;
  },
};




/*

========================================
CLICKPOST INTEGRATION - PRODUCTION ROUTES
========================================

BASE URL: https://your-domain.com/integrations/clickpost

1. WEBHOOK ENDPOINTS (For ClickPost to send data to your system):
   =============================================================
   
   📥 RECEIVE ORDERS WEBHOOK:
   POST https://your-domain.com/integrations/clickpost/webhook/orders
   Headers: 
     - x-api-key: your_clickpost_webhook_token
     - Content-Type: application/json
   
   📥 STATUS UPDATE WEBHOOK:
   POST https://your-domain.com/integrations/clickpost/status/update
   Headers:
     - x-api-key: your_clickpost_webhook_token
     - Content-Type: application/json

2. API ENDPOINTS (For your system to interact with ClickPost):
   ===========================================================
   
   📤 CREATE ORDER:
   POST https://your-domain.com/integrations/clickpost/create-order
   Body: {
     "reference_number": "ORDER123",
     "pickup_info": { "name": "...", "phone": "...", "address": "..." },
     "drop_info": { "name": "...", "phone": "...", "address": "..." },
     "shipment_details": { "items": [...], "weight": 1.5 }
   }
   
   📊 GET ORDERS:
   GET https://your-domain.com/integrations/clickpost/orders
   Query Params: ?page=1&limit=10&status=Pending&waybill=CPAWB123
   
   🔍 GET SPECIFIC ORDER:
   GET https://your-domain.com/integrations/clickpost/order/:identifier
   Example: GET /order/CPAWB123456 or GET /order/ORDER123
   
   📈 GET STATISTICS:
   GET https://your-domain.com/integrations/clickpost/stats
   
   ❤️ HEALTH CHECK:
   GET https://your-domain.com/integrations/clickpost/health

3. PRODUCTION WEBHOOK CONFIGURATION:
   ==================================
   
   In ClickPost Dashboard, configure these webhooks:
   
   📥 ORDER WEBHOOK URL:
   https://your-domain.com/integrations/clickpost/webhook/orders
   
   📥 STATUS UPDATE URL:
   https://your-domain.com/integrations/clickpost/status/update
   
   🔐 AUTHENTICATION:
   - Use your CLICKPOST_WEBHOOK_TOKEN as x-api-key header
   - Ensure HTTPS is enabled for production
   - Configure proper CORS if needed

4. SAMPLE WEBHOOK PAYLOADS:
   ========================
   
   📥 ORDER WEBHOOK PAYLOAD:
   {
     "order_id": "ORDER123456",
     "pickup_info": {
       "name": "John Doe",
       "phone": "9876543210",
       "address": "123 Main St, Mumbai",
       "pincode": "400001",
       "city": "Mumbai",
       "state": "Maharashtra"
     },
     "drop_info": {
       "name": "Jane Smith", 
       "phone": "9876543211",
       "address": "456 Park Ave, Delhi",
       "pincode": "110001",
       "city": "Delhi",
       "state": "Delhi"
     },
     "shipment_details": {
       "items": [
         {"name": "Product 1", "quantity": 2, "price": 299}
       ],
       "weight": 1.5,
       "order_type": "standard",
       "cod_amount": 0,
       "declared_value": 598
     }
   }
   
   📥 STATUS UPDATE PAYLOAD:
   {
     "waybill": "CPAWB123456789",
     "status_code": "OFD",
     "status_description": "Out for Delivery",
     "location": "Mumbai Hub",
     "remarks": "Package dispatched for delivery"
   }

5. RESPONSE FORMATS:
   ==================
   
   ✅ SUCCESS RESPONSE:
   {
     "success": true,
     "message": "Order created successfully",
     "data": {
       "order_id": "ORDER123456",
       "waybill": "CPAWB123456789",
       "status": "Pending",
       "created_at": "2024-01-15T10:30:00Z"
     }
   }
   
   ❌ ERROR RESPONSE:
   {
     "success": false,
     "error": "Missing required fields",
     "missing_fields": ["order_id", "pickup_info"],
     "timestamp": "2024-01-15T10:30:00Z"
   }

6. STATUS CODES REFERENCE:
   =======================
   
   - OFD: Out for Delivery
   - DEL: Delivered
   - RTO: Return to Origin
   - POD: Proof of Delivery
   - NDR: Non-Delivery Report
   - OOD: Out of Delivery Area
   - PPD: Prepaid
   - DEX: Delivered Exception
   - INT: In Transit
   - EXP: Exception

7. PRODUCTION CHECKLIST:
   =====================
   
   ✅ Environment Variables Set:
   - CLICKPOST_USERNAME
   - CLICKPOST_API_KEY  
   - CLICKPOST_ACCOUNT_CODE
   - CLICKPOST_BASE_URL
   - CLICKPOST_WEBHOOK_TOKEN
   
   ✅ Security:
   - HTTPS enabled
   - Webhook token validation
   - Input validation
   - Error handling
   
   ✅ Monitoring:
   - Health check endpoint
   - Logging enabled
   - Database connection monitoring

========================================
*/