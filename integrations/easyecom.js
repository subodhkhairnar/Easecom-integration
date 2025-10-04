// integrations/easyecom.js
const express = require('express');
const axios = require('axios');

let db; // Global DB from server.js

const router = express.Router();

// Load env vars
const {
  EASYECOM_API_URL,
  EASYECOM_API_KEY,
  EASYECOM_EMAIL,
  EASYECOM_PASSWORD,
  EASYECOM_LOCATION_KEY,
} = process.env;

// Fetches a fresh Access Token from the easyEcom authentication endpoint
const getAccessToken = async () => {
  console.log("\n[STEP 1] ➡️ Attempting to get new access token...");
  try {
    const authPayload = {
      email: EASYECOM_EMAIL,
      password: EASYECOM_PASSWORD,
      location_key: EASYECOM_LOCATION_KEY,
    };
    console.log("[STEP 1] 📋 Sending auth payload:", { ...authPayload, password: '***' });

    const response = await axios.post(`${EASYECOM_API_URL}/access/token`, authPayload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EASYECOM_API_KEY,
      },
    });

    console.log("[STEP 1] ✅ Received response from auth server.");
    const accessToken = response.data.data.token.jwt_token;

    if (!accessToken) {
      throw new Error("Token not found in API response.");
    }

    console.log("[STEP 1] ✨ Successfully extracted access token.");
    return accessToken;
  } catch (error) {
    console.error("❌ [STEP 1] ERROR fetching access token:", error.response ? error.response.data : error.message);
    throw new Error("Could not authenticate with easyEcom. Check credentials and previous logs.");
  }
};

// Route to PULL data from easyEcom with status change tracking
router.get('/pull-data', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/pull-data ---");
  try {
    const token = await getAccessToken();
    const params = {
      start_date: '2025-07-15 00:00:00',
      end_date: '2025-07-17 23:59:59',
    };

    const endpoint = '/orders/V2/getAllOrders';
    console.log(`[STEP 2] ➡️ Attempting to PULL data from ${endpoint} with params:`, params);

    const response = await axios.get(`${EASYECOM_API_URL}${endpoint}`, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
      },
      params,
    });

    console.log("[STEP 3] ✅ Successfully pulled order data.");

    if (response.data && response.data.data && response.data.data.orders) {
      const orders = response.data.data.orders;
      const collection = db.collection('easyecom_orders');
      let updatedCount = 0;
      let insertedCount = 0;
      const results = [];

      console.log(`[STEP 4] 🔄 Processing ${orders.length} orders with status tracking...`);

      for (const order of orders) {
        const currentTime = new Date();
        const filter = { order_id: order.order_id };
        const existingRecord = await collection.findOne(filter);

        if (existingRecord) {
          let orderUpdated = false;
          let statusChangeDetails = [];

          if (existingRecord.order_status !== order.order_status) {
            if (!existingRecord.status_history) {
              existingRecord.status_history = [];
            }
            existingRecord.status_history.push({
              old_status: existingRecord.order_status,
              new_status: order.order_status,
              timestamp: currentTime,
            });
            orderUpdated = true;
            statusChangeDetails.push({
              type: 'main_order',
              old_status: existingRecord.order_status,
              new_status: order.order_status,
            });
            console.log(`[STEP 4] 📊 Main order status changed: ${existingRecord.order_status} → ${order.order_status}`);
          }

          const updatedSuborders = [...existingRecord.suborders];

          for (let i = 0; i < order.suborders.length; i++) {
            const newSuborder = order.suborders[i];
            const existingSuborder = updatedSuborders.find(sub => sub.suborder_num === newSuborder.suborder_num);

            if (existingSuborder) {
              if (existingSuborder.order_status !== newSuborder.order_status) {
                if (!existingSuborder.status_history) {
                  existingSuborder.status_history = [];
                }
                existingSuborder.status_history.push({
                  old_status: existingSuborder.order_status,
                  new_status: newSuborder.order_status,
                  timestamp: currentTime,
                });
                Object.assign(existingSuborder, newSuborder);
                orderUpdated = true;
                statusChangeDetails.push({
                  type: 'suborder',
                  suborder_num: newSuborder.suborder_num,
                  old_status: existingSuborder.order_status,
                  new_status: newSuborder.order_status,
                });
                console.log(`[STEP 4] 📦 Suborder ${newSuborder.suborder_num} status changed: ${existingSuborder.order_status} → ${newSuborder.order_status}`);
              } else {
                Object.assign(existingSuborder, newSuborder);
              }
            } else {
              const newSuborderWithHistory = {
                ...newSuborder,
                status_history: [{ old_status: null, new_status: newSuborder.order_status, timestamp: currentTime }],
              };
              updatedSuborders.push(newSuborderWithHistory);
              orderUpdated = true;
              statusChangeDetails.push({
                type: 'new_suborder',
                suborder_num: newSuborder.suborder_num,
                status: newSuborder.order_status,
              });
              console.log(`[STEP 4] ➕ New suborder added: ${newSuborder.suborder_num}`);
            }
          }

          if (orderUpdated) {
            const updateData = {
              ...order,
              suborders: updatedSuborders,
              status_history: existingRecord.status_history || [],
              last_updated: currentTime,
            };
            await collection.updateOne(filter, { $set: updateData });
            updatedCount++;
            results.push({
              order_id: order.order_id,
              action: 'updated',
              status_changes: statusChangeDetails,
            });
            console.log(`[STEP 4] ✅ Updated order ${order.order_id} with status changes`);
          } else {
            console.log(`[STEP 4] ➖ No changes for order: ${order.order_id}`);
            results.push({ order_id: order.order_id, action: 'no_change' });
          }
        } else {
          const newOrderData = {
            ...order,
            status_history: [{ old_status: null, new_status: order.order_status, timestamp: currentTime }],
            created_at: currentTime,
            last_updated: currentTime,
          };
          newOrderData.suborders = order.suborders.map(suborder => ({
            ...suborder,
            status_history: [{ old_status: null, new_status: suborder.order_status, timestamp: currentTime }],
          }));
          await collection.insertOne(newOrderData);
          insertedCount++;
          results.push({ order_id: order.order_id, action: 'inserted' });
          console.log(`[STEP 4] ➕ Inserted new order: ${order.order_id}`);
        }
      }

      console.log(`[STEP 4] ✅ Processing complete!`);
      console.log(`[STEP 4] 📊 Summary: ${insertedCount} inserted, ${updatedCount} updated`);

      res.status(200).json({
        success: true,
        message: `Successfully processed ${orders.length} orders with status tracking`,
        summary: { total_processed: orders.length, inserted: insertedCount, updated: updatedCount },
        details: results,
        data: response.data,
      });
    } else {
      console.log("[STEP 4] ⚠️ No orders found in the response");
      res.status(200).json({
        success: true,
        message: "No orders found for the given date range",
        data: response.data,
      });
    }
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ [STEP 3/4] ERROR in /pull-data route:", JSON.stringify(errorData, null, 2));
    res.status(500).json({ success: false, error: errorData });
  }
});

// Get saved orders
router.get('/get-saved-orders', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/get-saved-orders ---");
  try {
    const collection = db.collection('easyecom_orders');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await collection.find({}).sort({ fetched_at: -1 }).skip(skip).limit(limit).toArray();
    const totalCount = await collection.countDocuments({});

    console.log(`✅ Retrieved ${orders.length} orders from MongoDB (Page ${page})`);

    res.status(200).json({
      success: true,
      data: orders,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(totalCount / limit),
        total_orders: totalCount,
        orders_per_page: limit,
      },
    });
  } catch (error) {
    console.error("❌ ERROR in /get-saved-orders route:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get orders by date range
router.get('/get-orders-by-date', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/get-orders-by-date ---");
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, error: "Please provide start_date and end_date parameters" });
    }

    const collection = db.collection('easyecom_orders');
    const orders = await collection.find({
      fetched_at: { $gte: new Date(start_date), $lte: new Date(end_date) },
    }).sort({ fetched_at: -1 }).toArray();

    console.log(`✅ Retrieved ${orders.length} orders from MongoDB for date range`);

    res.status(200).json({
      success: true,
      data: orders,
      count: orders.length,
      date_range: { start_date, end_date },
    });
  } catch (error) {
    console.error("❌ ERROR in /get-orders-by-date route:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Push data route
router.post('/push-data', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/push-data ---");
  try {
    const token = await getAccessToken();
    const newOrderPayload = {
      orderType: "retailorder",
      marketplaceId: 10,
      orderNumber: "Test-Order-02" + Date.now(),
      orderDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      paymentMode: 4,
      shippingMethod: 2,
      items: [{ Sku: "hubcrafter_test_sku", Quantity: "1", Price: 20 }],
      customer: [{
        billing: { name: "brown t-shirt", addressLine1: "123 Billing St", postalCode: "400067", city: "Mumbai", state: "Maharashtra", country: "India", contact: "9876543210", email: "billing@test.com" },
        shipping: { name: "brown t-shirt", addressLine1: "456 Shipping Ave", postalCode: "400067", city: "Mumbai", state: "Maharashtra", country: "India", contact: "9876543210", email: "shipping@test.com" },
      }],
    };

    console.log("[STEP 2] 📋 Create order payload:", JSON.stringify(newOrderPayload, null, 2));
    console.log("[STEP 3] ➡️ Attempting to PUSH data to /webhook/v2/createOrder...");

    const response = await axios.post(`${EASYECOM_API_URL}/webhook/v2/createOrder`, newOrderPayload, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });

    console.log("[STEP 3] ✅ Successfully pushed data.");
    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ [STEP 3] ERROR in /push-data route:", JSON.stringify(errorData, null, 2));
    res.status(500).json({ success: false, error: errorData });
  }
});

// Pull inventory
router.get('/pull-inventory', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/pull-inventory ---");
  try {
    const token = await getAccessToken();
    const params = {
      includeLocations: req.query.includeLocations || 1,
      limit: req.query.limit || 50,
      includeCustomers: req.query.includeCustomers || 0,
      get_back_orders: req.query.get_back_orders || false,
    };

    if (req.query.sku) {
      params.sku = req.query.sku;
    }

    const endpoint = '/getInventoryDetailsV3';
    console.log(`[STEP 2] ➡️ Attempting to PULL inventory from ${endpoint} with params:`, params);

    const response = await axios.get(`${EASYECOM_API_URL}${endpoint}`, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
      },
      params,
    });

    console.log("[STEP 3] ✅ Successfully pulled inventory data.");

    if (response.data && response.data.data) {
      let inventoryItems = [];
      if (Array.isArray(response.data.data)) {
        inventoryItems = response.data.data;
      } else if (response.data.data.inventory) {
        inventoryItems = response.data.data.inventory;
      } else if (response.data.data.products) {
        inventoryItems = response.data.data.products;
      } else if (response.data.data.items) {
        inventoryItems = response.data.data.items;
      } else {
        const collection = db.collection('easyecom_inventory');
        await collection.deleteMany({});
        await collection.insertOne({ raw_response: response.data, fetched_at: new Date(), note: "Raw response stored for analysis" });
        return res.status(200).json({
          success: true,
          message: "Raw response stored for analysis.",
          response_structure: {
            main_keys: Object.keys(response.data),
            data_keys: response.data.data ? Object.keys(response.data.data) : "No data object",
            data_type: Array.isArray(response.data.data) ? "array" : typeof response.data.data,
          },
          raw_data: response.data,
        });
      }

      if (inventoryItems.length > 0) {
        const collection = db.collection('easyecom_inventory');
        await collection.deleteMany({});
        let insertedCount = 0;
        const results = [];

        console.log(`[STEP 4] 🔄 Processing ${inventoryItems.length} inventory items...`);

        for (const item of inventoryItems) {
          const sku = item.sku || item.SKU || item.product_sku || item.item_sku || item.code;
          const quantity = item.quantity || item.available_quantity || item.stock_quantity || item.current_stock || item.available_stock || item.in_stock || 0;

          if (sku) {
            const cleanItem = {
              sku,
              quantity,
              original_data: item,
              processed_at: new Date(),
            };
            await collection.insertOne(cleanItem);
            insertedCount++;
            console.log(`[STEP 4] ✅ Processed item: ${sku} (qty: ${quantity})`);
            results.push({ sku, quantity, status: 'processed' });
          } else {
            console.log(`[STEP 4] ⚠️ No SKU found for item:`, item);
            results.push({ item, status: 'skipped_no_sku' });
          }
        }

        console.log(`[STEP 4] ✅ Processing complete! Inserted ${insertedCount} items`);

        res.status(200).json({
          success: true,
          message: `Successfully processed and stored ${insertedCount} inventory items`,
          summary: { total_received: inventoryItems.length, successfully_processed: insertedCount, skipped: inventoryItems.length - insertedCount },
          processing_details: results,
          raw_response_sample: inventoryItems[0],
        });
      } else {
        console.log("[STEP 4] ⚠️ No inventory items found in the response");
        res.status(200).json({
          success: true,
          message: "No inventory items found",
          response_data: response.data,
        });
      }
    } else {
      console.log("[STEP 4] ⚠️ Unexpected response structure - no data field");
      res.status(200).json({
        success: false,
        message: "Unexpected response structure",
        response: response.data,
      });
    }
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ [STEP 3/4] ERROR in /pull-inventory route:", JSON.stringify(errorData, null, 2));
    res.status(500).json({ success: false, error: errorData });
  }
});

// Push dummy inventory
const pushDummyInventoryData = async () => {
  console.log("\n\n--- pushDummyInventoryData Function Called ---");
  try {
    const token = await getAccessToken();
    const dummyInventoryData = [
      { sku: "DUMMY-SKU-001", quantity: 50, cost: 299 },
      { sku: "DUMMY-SKU-002", quantity: 25, cost: 499 },
      { sku: "DUMMY-SKU-003", quantity: 10, cost: 799 },
    ];

    console.log("[STEP 2] 🔄 Creating dummy inventory data...");

    const bulkPayload = {
      skus: dummyInventoryData.map(item => ({
        sku: item.sku,
        quantity: item.quantity,
        cost: item.cost,
      })),
    };

    console.log("[STEP 3] 📋 Dummy bulk payload prepared:", JSON.stringify(bulkPayload, null, 2));

    const endpoint = '/inventory/bulkInventoryUpdate';
    console.log(`[STEP 4] ➡️ Sending dummy bulk inventory update to ${endpoint}...`);

    const response = await axios.post(`${EASYECOM_API_URL}${endpoint}`, bulkPayload, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log("[STEP 4] ✅ Successfully sent dummy bulk inventory update to easyEcom");
    console.log("[STEP 4] 📊 easyEcom Response:", JSON.stringify(response.data, null, 2));

    return {
      success: true,
      message: `Successfully uploaded ${dummyInventoryData.length} dummy inventory items to easyEcom`,
      uploaded_count: dummyInventoryData.length,
      uploaded_skus: dummyInventoryData.map(item => item.sku),
      easyecom_response: response.data,
    };
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ ERROR in pushDummyInventoryData:", JSON.stringify(errorData, null, 2));
    return {
      success: false,
      error: errorData,
      message: "Failed to upload dummy inventory to easyEcom",
    };
  }
};

router.post('/push-dummy-inventory', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/push-dummy-inventory ---");
  try {
    const result = await pushDummyInventoryData();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ ERROR in /push-dummy-inventory route:", error.message);
    res.status(500).json({ success: false, error: error.message, message: "Failed to push dummy inventory" });
  }
});

// Push three real inventory items
const pushThreeRealInventoryItems = async () => {
  console.log("\n\n--- pushThreeRealInventoryItems Function Called ---");
  try {
    const token = await getAccessToken();
    console.log("[STEP 2] ➡️ Fetching inventory data from MongoDB...");
    const collection = db.collection('easyecom_inventory');

    const document = await collection.findOne({});

    if (!document || !document.raw_response?.data?.inventoryData) {
      return { success: false, message: "No inventory data found in database nested structure" };
    }

    const inventoryArray = document.raw_response.data.inventoryData;
    const threeItems = inventoryArray.slice(0, 3);
    console.log(`[STEP 3] 📦 Extracted 3 items from ${inventoryArray.length} total items`);

    console.log("[STEP 4] 🔄 Transforming data for bulk upload...");

    const bulkPayload = {
      skus: threeItems.map(item => {
        const quantity = item.availableInventory || item.virtual_inventory_count || 10;
        return { sku: item.sku, quantity: Math.max(quantity, 10) };
      }).filter(item => item.sku),
    };

    console.log("[STEP 4] 📋 Real inventory bulk payload prepared (minimum quantity 10):");
    console.log(JSON.stringify(bulkPayload, null, 2));

    const endpoint = '/inventory/bulkInventoryUpdate';
    console.log(`[STEP 5] ➡️ Sending real inventory bulk update to ${endpoint}...`);

    const response = await axios.post(`${EASYECOM_API_URL}${endpoint}`, bulkPayload, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log("[STEP 5] ✅ Successfully sent real inventory bulk update to easyEcom");
    console.log("[STEP 5] 📊 easyEcom Response:", JSON.stringify(response.data, null, 2));

    const successfulSkus = bulkPayload.skus.map(item => item.sku);
    console.log(`[STEP 6] 🎉 Real inventory upload completed for ${successfulSkus.length} SKUs`);

    return {
      success: true,
      message: `Successfully uploaded ${successfulSkus.length} real inventory items to easyEcom (min qty 10)`,
      uploaded_count: successfulSkus.length,
      uploaded_skus: successfulSkus,
      original_items: threeItems.map(item => ({
        sku: item.sku,
        original_quantity: item.availableInventory,
        virtual_count: item.virtual_inventory_count,
        sent_quantity: Math.max(item.availableInventory || item.virtual_inventory_count || 10, 10),
      })),
      easyecom_response: response.data,
    };
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ ERROR in pushThreeRealInventoryItems:", JSON.stringify(errorData, null, 2));
    return {
      success: false,
      error: errorData,
      message: "Failed to upload real inventory to easyEcom",
    };
  }
};

router.post('/push-three-real-inventory', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/push-three-real-inventory ---");
  try {
    const result = await pushThreeRealInventoryItems();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ ERROR in /push-three-real-inventory route:", error.message);
    res.status(500).json({ success: false, error: error.message, message: "Failed to push three real inventory items" });
  }
});

// Push original inventory
const pushOriginalInventoryData = async (limit = 10) => {
  console.log("\n\n--- pushOriginalInventoryData Function Called ---");
  try {
    const token = await getAccessToken();
    console.log("[STEP 2] ➡️ Fetching inventory data from MongoDB...");
    const collection = db.collection('easyecom_inventory');

    const document = await collection.findOne({});

    if (!document || !document.raw_response?.data?.inventoryData) {
      return { success: false, message: "No inventory data found in database nested structure" };
    }

    const inventoryArray = document.raw_response.data.inventoryData;
    const itemsToProcess = inventoryArray.slice(0, limit);
    console.log(`[STEP 3] 📦 Extracted ${itemsToProcess.length} items from ${inventoryArray.length} total items`);

    console.log("[STEP 4] 🔄 Transforming ORIGINAL data (including zero quantities)...");

    const bulkPayload = {
      skus: itemsToProcess.map(item => {
        const originalQuantity = item.availableInventory !== null ? item.availableInventory : item.virtual_inventory_count;
        console.log(`[STEP 4] 📊 Original SKU: ${item.sku}, Original Qty: ${originalQuantity} (availableInventory: ${item.availableInventory}, virtual_count: ${item.virtual_inventory_count})`);
        return { sku: item.sku, quantity: originalQuantity || 0 };
      }).filter(item => item.sku),
    };

    console.log("[STEP 4] 📋 Original inventory bulk payload (with zero quantities):");
    console.log(JSON.stringify(bulkPayload, null, 2));

    const endpoint = '/inventory/bulkInventoryUpdate';
    console.log(`[STEP 5] ➡️ Sending original inventory bulk update to ${endpoint}...`);

    const response = await axios.post(`${EASYECOM_API_URL}${endpoint}`, bulkPayload, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log("[STEP 5] ✅ Successfully sent original inventory bulk update to easyEcom");
    console.log("[STEP 5] 📊 easyEcom Response:", JSON.stringify(response.data, null, 2));

    const processedItems = bulkPayload.skus.map(item => item.sku);
    const zeroQuantityItems = bulkPayload.skus.filter(item => item.quantity === 0);
    console.log(`[STEP 6] 🎉 Original inventory upload completed for ${processedItems.length} SKUs`);

    return {
      success: true,
      message: `Successfully uploaded ${processedItems.length} original inventory items to easyEcom`,
      uploaded_count: processedItems.length,
      zero_quantity_count: zeroQuantityItems.length,
      uploaded_skus: processedItems,
      detailed_items: bulkPayload.skus.map(item => ({ sku: item.sku, quantity_sent: item.quantity })),
      easyecom_response: response.data,
    };
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ ERROR in pushOriginalInventoryData:", JSON.stringify(errorData, null, 2));
    return {
      success: false,
      error: errorData,
      message: "Failed to upload original inventory to easyEcom",
    };
  }
};

router.post('/push-original-inventory', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/push-original-inventory ---");
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await pushOriginalInventoryData(limit);
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error("❌ ERROR in /push-original-inventory route:", error.message);
    res.status(500).json({ success: false, error: error.message, message: "Failed to push original inventory items" });
  }
});

// Push bulk inventory
router.post('/push-bulk-inventory', async (req, res) => {
  console.log("\n\n--- Received request for /integrations/easyecom/push-bulk-inventory ---");
  try {
    const token = await getAccessToken();
    console.log("[STEP 2] ➡️ Fetching inventory data from MongoDB...");
    const collection = db.collection('easyecom_inventory');

    const limit = parseInt(req.query.limit) || 100;
    const skuFilter = req.query.sku;

    const filter = {};
    if (skuFilter) {
      filter.sku = new RegExp(skuFilter, 'i');
    }

    const inventoryItems = await collection.find(filter).limit(limit).toArray();

    if (inventoryItems.length === 0) {
      return res.status(400).json({ success: false, message: "No inventory items found in database to upload" });
    }

    console.log(`[STEP 2] ✅ Found ${inventoryItems.length} inventory items in MongoDB`);

    console.log("[STEP 3] 🔄 Transforming data for bulk upload...");

    const bulkPayload = {
      skus: inventoryItems.map(item => ({
        sku: item.sku,
        quantity: item.quantity || item.available_quantity || item.stock_quantity || 0,
      })),
    };

    console.log("[STEP 3] 📋 Bulk payload prepared:", JSON.stringify(bulkPayload, null, 2));

    const endpoint = '/inventory/bulkInventoryUpdate';
    console.log(`[STEP 4] ➡️ Sending bulk inventory update to ${endpoint}...`);

    const response = await axios.post(`${EASYECOM_API_URL}${endpoint}`, bulkPayload, {
      headers: {
        'x-api-key': EASYECOM_API_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log("[STEP 4] ✅ Successfully sent bulk inventory update to easyEcom");
    console.log("[STEP 4] 📊 easyEcom Response:", JSON.stringify(response.data, null, 2));

    const successfulSkus = bulkPayload.skus.map(item => item.sku);
    console.log(`[STEP 5] 🎉 Bulk upload completed for ${successfulSkus.length} SKUs`);

    res.status(200).json({
      success: true,
      message: `Successfully uploaded ${successfulSkus.length} inventory items to easyEcom`,
      uploaded_count: successfulSkus.length,
      uploaded_skus: successfulSkus,
      easyecom_response: response.data,
    });
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("❌ ERROR in /push-bulk-inventory route:", JSON.stringify(errorData, null, 2));
    res.status(500).json({ success: false, error: errorData, message: "Failed to upload bulk inventory to easyEcom" });
  }
});

module.exports = {
  router,
  init: (globalDb) => {
    db = globalDb;
  },
};



/*
EasyEcom:

GET http://localhost:3000/integrations/easyecom/pull-data
GET http://localhost:3000/integrations/easyecom/get-saved-orders?page=1&limit=10
POST http://localhost:3000/integrations/easyecom/push-data
POST http://localhost:3000/integrations/easyecom/push-dummy-inventory
POST http://localhost:3000/integrations/easyecom/push-three-real-inventory
POST http://localhost:3000/integrations/easyecom/push-original-inventory?limit=10

*/