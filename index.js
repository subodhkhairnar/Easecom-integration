// Description: This Node.js server connects to the easyEcom API to pull and push order data.
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
//const port = 3001;
const port = process.env.PORT || 3001;

app.use(bodyParser.json());

// --- Load all credentials from .env file ---
const {
  EASYECOM_API_URL,
  EASYECOM_API_KEY,
  EASYECOM_EMAIL,
  EASYECOM_PASSWORD,
  EASYECOM_LOCATION_KEY,
  MONGODB_URI,
  EASYECOM_WEBHOOK_TOKEN
} = process.env;

// MongoDB connection
let db;
const connectMongoDB = async () => {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('Orders'); // Database name
    console.log('✅ Connected to MongoDB - Orders database');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

/**
 * Fetches a fresh Access Token from the easyEcom authentication endpoint.
 */
const getAccessToken = async () => {
  console.log("\n[STEP 1] ➡️  Attempting to get new access token...");
  try {
    const authPayload = {
      email: EASYECOM_EMAIL,
      password: EASYECOM_PASSWORD,
      location_key: EASYECOM_LOCATION_KEY
    };
    console.log("[STEP 1] 📋  Sending auth payload:", { ...authPayload, password: '***' });

    const response = await axios.post(`${EASYECOM_API_URL}/access/token`, 
      authPayload, 
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': EASYECOM_API_KEY
        }
      }
    );
    
    console.log("[STEP 1] ✅  Received response from auth server.");
    const accessToken = response.data.data.token.jwt_token; 
    
    if (!accessToken) {
        throw new Error("Token not found in API response.");
    }
    
    console.log("[STEP 1] ✨  Successfully extracted access token.");
    return accessToken;

  } catch (error) {
    console.error("❌ [STEP 1] ERROR fetching access token:", error.response ? error.response.data : error.message);
    throw new Error("Could not authenticate with easyEcom. Check credentials and previous logs.");
  }};


/**
 * Middleware to secure webhook endpoints.
 * It checks for a valid token in either the 'Access-token' or 'Authorization' header.
 */
const authenticateWebhook = (req, res, next) => {
    console.log("-> Running Webhook Authentication check...");

    // EasyEcom can send the token in one of two headers. We check both.
    let providedToken = req.header('Access-token');
    
    // If 'Access-token' is not found, check 'Authorization' header (e.g., "Bearer {token}")
    if (!providedToken && req.header('Authorization')) {
        const authHeader = req.header('Authorization');
        if (authHeader.startsWith('Bearer ')) {
            providedToken = authHeader.substring(7, authHeader.length);
        }
    }

    // 1. Check if a token was provided at all
    if (!providedToken) {
        console.log("❌ Authentication failed: No token found in headers.");
        // 401 Unauthorized is the appropriate status code here
        return res.status(401).json({ message: 'Unauthorized: Access token is missing from headers.' });
    }

    // 2. Check if the provided token matches our secret token
    if (providedToken !== EASYECOM_WEBHOOK_TOKEN) {
        console.log("❌ Authentication failed: Invalid token.");
        // 403 Forbidden is appropriate when the token is present but incorrect
        return res.status(403).json({ message: 'Forbidden: The provided access token is invalid.' });
    }

    // If both checks pass, we can proceed to the actual route handler
    console.log("✅ Webhook authenticated successfully.");
    next(); 
};


app.post('/webhook/create-order', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/create-order");

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log("-> Detected V2 payload format (JSON array).");
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log("-> Detected V1 payload format (Object with 'orders' key).");
            ordersToProcess = req.body.orders;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        // Validate that the resulting array is not empty
        if (ordersToProcess.length === 0) {
            console.log("❌ Validation failed: The 'orders' array is empty.");
            return res.status(400).json({ message: "Bad Request: Empty 'orders' array." });
        }

        console.log(`➡️  Received ${ordersToProcess.length} order(s) to process.`);

        // Get a reference to your MongoDB collection
        const collection = db.collection('easyecom_orders');

        // Insert the new orders into the collection
        const result = await collection.insertMany(ordersToProcess);
        console.log(`✅  Successfully inserted ${result.insertedCount} new order(s) into MongoDB.`);

        // Send a success response
        res.status(201).json({ 
            message: 'Webhook received successfully. Orders created.', 
            insertedCount: result.insertedCount 
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/create-order:", error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook.', 
            error: error.message 
        });
    }
});




/**
 * Webhook endpoint to confirm an existing order.
 * Handles both V1 ({ "orders": [...] }) and V2 ([...]) payload structures.
 */
app.post('/webhook/confirm-order', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/confirm-order");

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log("-> Detected V2 payload format (JSON array).");
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log("-> Detected V1 payload format (Object with 'orders' key).");
            ordersToProcess = req.body.orders;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        if (ordersToProcess.length === 0) {
            console.log("❌ Validation failed: 'orders' array is empty.");
            return res.status(400).json({ message: "Bad Request: Empty 'orders' array." });
        }

        console.log(`➡️  Received ${ordersToProcess.length} confirmed order(s) to process.`);
        const collection = db.collection('easyecom_orders');
        let updateCount = 0;

        for (const order of ordersToProcess) {
            const { order_id } = order;

            if (!order_id) {
                console.log("⚠️  Skipping order due to missing 'order_id'.");
                continue;
            }
            
            // The update logic remains the same, as '$set' will handle
            // adding new fields and updating existing ones.
            const result = await collection.updateOne(
                { order_id: order_id },
                { $set: order }
            );

            if (result.matchedCount > 0) {
                updateCount++;
                console.log(`   - Successfully updated order_id: ${order_id}`);
            } else {
                console.log(`   - Warning: No matching order found for order_id: ${order_id}. Nothing updated.`);
            }
        }

        console.log(`✅  Process complete. Successfully updated ${updateCount} of ${ordersToProcess.length} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully. Orders updated.', 
            updatedCount: updateCount,
            receivedCount: ordersToProcess.length
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/confirm-order:", error.message);
        res.status(500).json({ message: 'Failed to process webhook.', error: error.message });
    }
});



app.post('/webhook/ready-to-dispatch', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/confirm-order");

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log("-> Detected V2 payload format (JSON array).");
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log("-> Detected V1 payload format (Object with 'orders' key).");
            ordersToProcess = req.body.orders;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        if (ordersToProcess.length === 0) {
            console.log("❌ Validation failed: 'orders' array is empty.");
            return res.status(400).json({ message: "Bad Request: Empty 'orders' array." });
        }

        console.log(`➡️  Received ${ordersToProcess.length} confirmed order(s) to process.`);
        const collection = db.collection('easyecom_orders');
        let updateCount = 0;

        for (const order of ordersToProcess) {
            const { order_id } = order;

            if (!order_id) {
                console.log("⚠️  Skipping order due to missing 'order_id'.");
                continue;
            }
            
            // The update logic remains the same, as '$set' will handle
            // adding new fields and updating existing ones.
            const result = await collection.updateOne(
                { order_id: order_id },
                { $set: order }
            );

            if (result.matchedCount > 0) {
                updateCount++;
                console.log(`   - Successfully updated order_id: ${order_id}`);
            } else {
                console.log(`   - Warning: No matching order found for order_id: ${order_id}. Nothing updated.`);
            }
        }

        console.log(`✅  Process complete. Successfully updated ${updateCount} of ${ordersToProcess.length} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully. Orders updated.', 
            updatedCount: updateCount,
            receivedCount: ordersToProcess.length
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/confirm-order:", error.message);
        res.status(500).json({ message: 'Failed to process webhook.', error: error.message });
    }
});


app.post('/webhook/manifested', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/confirm-order");

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log("-> Detected V2 payload format (JSON array).");
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log("-> Detected V1 payload format (Object with 'orders' key).");
            ordersToProcess = req.body.orders;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        if (ordersToProcess.length === 0) {
            console.log("❌ Validation failed: 'orders' array is empty.");
            return res.status(400).json({ message: "Bad Request: Empty 'orders' array." });
        }

        console.log(`➡️  Received ${ordersToProcess.length} confirmed order(s) to process.`);
        const collection = db.collection('easyecom_orders');
        let updateCount = 0;

        for (const order of ordersToProcess) {
            const { order_id } = order;

            if (!order_id) {
                console.log("⚠️  Skipping order due to missing 'order_id'.");
                continue;
            }
            
            // The update logic remains the same, as '$set' will handle
            // adding new fields and updating existing ones.
            const result = await collection.updateOne(
                { order_id: order_id },
                { $set: order }
            );

            if (result.matchedCount > 0) {
                updateCount++;
                console.log(`   - Successfully updated order_id: ${order_id}`);
            } else {
                console.log(`   - Warning: No matching order found for order_id: ${order_id}. Nothing updated.`);
            }
        }

        console.log(`✅  Process complete. Successfully updated ${updateCount} of ${ordersToProcess.length} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully. Orders updated.', 
            updatedCount: updateCount,
            receivedCount: ordersToProcess.length
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/confirm-order:", error.message);
        res.status(500).json({ message: 'Failed to process webhook.', error: error.message });
    }
});


app.post('/webhook/cancel-order', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/confirm-order");

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log("-> Detected V2 payload format (JSON array).");
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log("-> Detected V1 payload format (Object with 'orders' key).");
            ordersToProcess = req.body.orders;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        if (ordersToProcess.length === 0) {
            console.log("❌ Validation failed: 'orders' array is empty.");
            return res.status(400).json({ message: "Bad Request: Empty 'orders' array." });
        }

        console.log(`➡️  Received ${ordersToProcess.length} confirmed order(s) to process.`);
        const collection = db.collection('easyecom_orders');
        let updateCount = 0;

        for (const order of ordersToProcess) {
            const { order_id } = order;

            if (!order_id) {
                console.log("⚠️  Skipping order due to missing 'order_id'.");
                continue;
            }
            
            // The update logic remains the same, as '$set' will handle
            // adding new fields and updating existing ones.
            const result = await collection.updateOne(
                { order_id: order_id },
                { $set: order }
            );

            if (result.matchedCount > 0) {
                updateCount++;
                console.log(`   - Successfully updated order_id: ${order_id}`);
            } else {
                console.log(`   - Warning: No matching order found for order_id: ${order_id}. Nothing updated.`);
            }
        }

        console.log(`✅  Process complete. Successfully updated ${updateCount} of ${ordersToProcess.length} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully. Orders updated.', 
            updatedCount: updateCount,
            receivedCount: ordersToProcess.length
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/confirm-order:", error.message);
        res.status(500).json({ message: 'Failed to process webhook.', error: error.message });
    }
});

/**
 * Webhook endpoint to process order returns.
 * Handles multiple payload structures, including V1 (object) and V2 (nested array).
 * Listens for POST requests at /webhook/mark-return
 */
app.post('/webhook/mark-return', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/mark-return");

        // --- INTELLIGENT PAYLOAD DETECTION for V1 and V2 ---
        let creditNotesToProcess;
        if (Array.isArray(req.body) && req.body.length > 0 && Array.isArray(req.body[0])) {
            // This is a V2 payload: a nested array `[ [ ... ] ]`
            console.log("-> Detected V2 payload format (nested array).");
            creditNotesToProcess = req.body[0]; // The actual data is in the first element
        } else if (req.body && Array.isArray(req.body.credit_notes)) {
            // This is a V1 payload: an object with a 'credit_notes' key `{ "credit_notes": [...] }`
            console.log("-> Detected V1 payload format (Object with 'credit_notes' key).");
            creditNotesToProcess = req.body.credit_notes;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 return format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        if (!creditNotesToProcess || creditNotesToProcess.length === 0) {
            console.log("❌ Validation failed: The 'credit_notes' array is empty after processing.");
            return res.status(400).json({ message: "Bad Request: Empty 'credit_notes' array." });
        }

        console.log(`➡️  Received ${creditNotesToProcess.length} return(s) to process.`);
        const collection = db.collection('easyecom_orders');
        let updatedCount = 0;

        for (const creditNote of creditNotesToProcess) {
            const { order_id } = creditNote;

            if (!order_id) {
                console.log("⚠️  Skipping credit note due to missing 'order_id'.");
                continue;
            }
            
            const result = await collection.updateOne(
                { order_id: order_id },
                { 
                    $push: { returns: creditNote },
                    $set: { order_status: "Returned" }
                }
            );

            if (result.matchedCount > 0) {
                updatedCount++;
                console.log(`   - Successfully added return info to order_id: ${order_id}`);
            } else {
                console.log(`   - Warning: No matching order found for order_id: ${order_id}.`);
            }
        }

        console.log(`✅  Process complete. Successfully updated ${updatedCount} order(s) with return information.`);

        res.status(200).json({ 
            message: 'Return webhook processed successfully.', 
            processedReturns: updatedCount 
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/mark-return:", error.message);
        res.status(500).json({ 
            message: 'Failed to process return webhook.', 
            error: error.message 
        });
    }
});


/**
 * Webhook endpoint to update inventory levels for products.
 * It uses an upsert operation to update existing products or create new ones.
 * Listens for POST requests at /webhook/update-inventory
 */
app.post('/webhook/update-inventory', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/update-inventory");

        // 1. The payload for inventory updates contains an 'inventoryData' array.
        const inventoryUpdates = req.body.inventoryData;

        // 2. Validate the payload structure.
        if (!inventoryUpdates || !Array.isArray(inventoryUpdates) || inventoryUpdates.length === 0) {
            console.log("❌ Validation failed: 'inventoryData' array is missing or empty.");
            return res.status(400).json({ message: "Bad Request: Missing or empty 'inventoryData' array." });
        }

        console.log(`➡️  Received ${inventoryUpdates.length} inventory update(s) to process.`);
        
        // 3. Get a reference to your 'inventory' collection.
        // This will either use an existing collection or create a new one on first use.
        const collection = db.collection('inventory');
        let processedCount = 0;

        // 4. Loop through each inventory update in the payload.
        for (const item of inventoryUpdates) {
            const { sku, warehouse_id } = item;

            if (!sku || !warehouse_id) {
                console.log("⚠️  Skipping item due to missing 'sku' or 'warehouse_id'.");
                continue;
            }

            // 5. Perform an "upsert" operation.
            // This finds a document matching the SKU and warehouse ID.
            // If it finds one, it updates it. If not, it creates a new one.
            await collection.updateOne(
                { sku: sku, warehouse_id: warehouse_id }, // The filter to find the document
                { $set: item },                            // The data to apply
                { upsert: true }                           // The option to enable upsert
            );
            
            processedCount++;
            console.log(`   - Processed update for SKU: ${sku} at warehouse: ${warehouse_id}`);
        }

        console.log(`✅  Process complete. Successfully processed ${processedCount} inventory update(s).`);

        // 6. Send a success response.
        res.status(200).json({ 
            message: 'Inventory webhook processed successfully.', 
            processedItems: processedCount 
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/update-inventory:", error.message);
        res.status(500).json({ 
            message: 'Failed to process inventory webhook.', 
            error: error.message 
        });
    }
});


/**
 * Webhook endpoint for order tracking updates. (Corrected Version)
 * It searches for the specific suborder and embeds the tracking data, ensuring data types match.
 * Listens for POST requests at /webhook/order-tracking
 */
app.post('/webhook/order-tracking', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/order-tracking");

        const trackingUpdates = req.body;

        if (!Array.isArray(trackingUpdates) || trackingUpdates.length === 0) {
            console.log("❌ Validation failed: Payload is not a valid array or is empty.");
            return res.status(400).json({ message: "Bad Request: Invalid or empty payload." });
        }

        console.log(`➡️  Received ${trackingUpdates.length} tracking update(s) to process.`);

        const collection = db.collection('easyecom_orders');
        let processedCount = 0;

        for (const update of trackingUpdates) {
            // --- DATA TYPE CORRECTION ---
            // Explicitly parse the incoming IDs to ensure they are Numbers, matching the database.
            const numericOrderId = parseInt(update.orderId, 10);
            const numericSubOrderId = parseInt(update.suborder_id, 10);
            
            // Validate that parsing was successful and we have valid numbers.
            if (isNaN(numericOrderId) || isNaN(numericSubOrderId)) {
                console.log(`⚠️  Skipping update due to invalid 'orderId' (${update.orderId}) or 'suborder_id' (${update.suborder_id}).`);
                continue;
            }
            // --- END OF CORRECTION ---

            // The rest of the logic uses the corrected numeric IDs.
            const result = await collection.updateOne(
                { 
                    order_id: numericOrderId, // Use the parsed Number
                    "suborders.suborder_id": numericSubOrderId // Use the parsed Number
                },
                { 
                    $set: { 
                        "suborders.$[elem].tracking_data": update // Embed the full tracking object
                    } 
                },
                { 
                    arrayFilters: [ { "elem.suborder_id": numericSubOrderId } ] // Filter using the parsed Number
                }
            );

            if (result.matchedCount > 0) {
                processedCount++;
                console.log(`   - Successfully updated tracking for order_id: ${numericOrderId}, suborder_id: ${numericSubOrderId}`);
            } else {
                console.log(`   - Warning: No matching order/suborder found for order_id: ${numericOrderId}, suborder_id: ${numericSubOrderId}.`);
            }
        }

        console.log(`✅  Process complete. Successfully processed ${processedCount} tracking update(s).`);

        res.status(200).json({ 
            message: 'Order tracking webhook processed successfully.', 
            processedUpdates: processedCount 
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/order-tracking:", error.message);
        res.status(500).json({ 
            message: 'Failed to process order tracking webhook.', 
            error: error.message 
        });
    }
});


app.post('/webhook/fetch-orders', authenticateWebhook, async (req, res) => {
    try {
        console.log("\nReceived authenticated request at /webhook/create-order");

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log("-> Detected V2 payload format (JSON array).");
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log("-> Detected V1 payload format (Object with 'orders' key).");
            ordersToProcess = req.body.orders;
        } else {
            // The payload is in an unknown or invalid format
            console.log("❌ Validation failed: Payload is not a valid V1 or V2 format.");
            return res.status(400).json({ message: "Bad Request: Invalid or unrecognized payload structure." });
        }
        // --- END OF DETECTION ---

        // Validate that the resulting array is not empty
        if (ordersToProcess.length === 0) {
            console.log("❌ Validation failed: The 'orders' array is empty.");
            return res.status(400).json({ message: "Bad Request: Empty 'orders' array." });
        }

        console.log(`➡️  Received ${ordersToProcess.length} order(s) to process.`);

        // Get a reference to your MongoDB collection
        const collection = db.collection('easyecom_orders');

        // Insert the new orders into the collection
        const result = await collection.insertMany(ordersToProcess);
        console.log(`✅  Successfully inserted ${result.insertedCount} new order(s) into MongoDB.`);

        // Send a success response
        res.status(201).json({ 
            message: 'Webhook received successfully. Orders created.', 
            insertedCount: result.insertedCount 
        });

    } catch (error) {
        console.error("❌ ERROR processing /webhook/create-order:", error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook.', 
            error: error.message 
        });
    }
});







  const startServer = async () => {
    await connectMongoDB();
    
    // Get and display JWT token
    try {
        console.log("\n🔐 Fetching JWT token for easyEcom API...");
        const token = await getAccessToken();
        console.log(`✅ JWT Token retrieved successfully:`);
        console.log(`🔑 Full JWT Token: ${token}`);
    } catch (error) {
        console.error("❌ Failed to retrieve JWT token:", error.message);
    }
    
    app.listen(port, () => {
        console.log(`✅ Server is running on http://localhost:${port}`);
        console.log("-----------------------------------------");
        console.log(`-> POST http://localhost:${port}/webhook/create-order`);
    });
};


startServer().catch(console.error);
