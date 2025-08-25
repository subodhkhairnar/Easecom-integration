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


const syncOrderStatus = async (db, orderId, newOrderData, source, options = {}) => {
    const logPrefix = "[SyncOrderStatus_Final_Verbose]";
    try {
        console.log(`\n${logPrefix} ---> Starting sync for orderId: ${orderId} from source: ${source}`);
        if (!db) throw new Error("Database not connected.");

        const collection = db.collection('easyecom_orders');
        const currentTime = new Date();
        const filter = { order_id: orderId };

        console.log(`${logPrefix} Searching for existing order with ID: ${orderId}...`);
        const existingOrder = await collection.findOne(filter);
        console.log(`${logPrefix} ...Order found: ${!!existingOrder}`);

        // if (!existingOrder) {
        //     // --- CREATION LOGIC ---
        //     console.log(`${logPrefix} [ACTION] Order not found. Entering CREATE logic.`);
        //     const docToInsert = { ...newOrderData };
        //     const initialHistoryEntry = (status) => ({
        //         old_status: null, new_status: status, timestamp: currentTime, source: `created-by-${source}`
        //     });

        //     console.log(`${logPrefix} Adding initial history for main order status: '${docToInsert.order_status}'`);
        //     docToInsert.status_history = [initialHistoryEntry(docToInsert.order_status)];
            
        //     const itemKey = docToInsert.order_items ? 'order_items' : 'suborders';
        //     if (docToInsert[itemKey]) {
        //         console.log(`${logPrefix} Adding initial history for ${docToInsert[itemKey].length} sub-order(s).`);
        //         docToInsert[itemKey].forEach(item => {
        //             item.item_status = item.item_status || docToInsert.order_status;
        //             item.status_history = [initialHistoryEntry(item.item_status)];
        //         });
        //     }
            
        //     console.log(`${logPrefix} Document ready for insertion.`);
        //     await collection.insertOne(docToInsert);
        //     console.log(`${logPrefix} ✅ Successfully created new order.`);
        //     return { success: true, action: 'inserted', changes: ['new_order_with_history'] };
        // }

        if (!existingOrder) {
    // --- CREATION LOGIC ---
    console.log(`${logPrefix} [ACTION] Order not found. Entering CREATE logic.`);
    const docToInsert = { ...newOrderData };

    // 🔹 Client attach logic (new)
    if (newOrderData.packer) {
        const clientCollection = db.collection('client');
        const clientData = await clientCollection.findOne({ email: newOrderData.packer });

        if (clientData) {
            docToInsert.client_id = clientData._id;
            docToInsert.client_email = clientData.email;
            docToInsert.client_company_name = clientData.company_name;
            console.log(`${logPrefix} ✅ Matched client by packer email: ${clientData.email}`);
        } else {
            console.log(`${logPrefix} ⚠️ No client found for packer email: ${newOrderData.packer}`);
        }
    }

    const initialHistoryEntry = (status) => ({
        old_status: null, new_status: status, timestamp: currentTime, source: `created-by-${source}`
    });

    console.log(`${logPrefix} Adding initial history for main order status: '${docToInsert.order_status}'`);
    docToInsert.status_history = [initialHistoryEntry(docToInsert.order_status)];
    
    const itemKey = docToInsert.order_items ? 'order_items' : 'suborders';
    if (docToInsert[itemKey]) {
        console.log(`${logPrefix} Adding initial history for ${docToInsert[itemKey].length} sub-order(s).`);
        docToInsert[itemKey].forEach(item => {
            item.item_status = item.item_status || docToInsert.order_status;
            item.status_history = [initialHistoryEntry(item.item_status)];
        });
    }
    
    console.log(`${logPrefix} Document ready for insertion.`);
    await collection.insertOne(docToInsert);
    console.log(`${logPrefix} ✅ Successfully created new order.`);
    return { success: true, action: 'inserted', changes: ['new_order_with_history'] };
}


        // --- UPDATE LOGIC ---
        console.log(`${logPrefix} [ACTION] Order found. Entering UPDATE logic.`);
        let changesDetected = [];
        let needsUpdate = false;
        
        const updatedOrder = JSON.parse(JSON.stringify(existingOrder)); // Deep copy

        // 1. Update main order status
        console.log(`${logPrefix} [1] Checking main status. DB: '${updatedOrder.order_status}', New: '${newOrderData.order_status}'`);
        if (newOrderData.order_status && updatedOrder.order_status !== newOrderData.order_status) {
            console.log(`${logPrefix} [1a] --> CHANGE DETECTED. Updating main status and adding to history.`);
            const oldStatus = updatedOrder.order_status;
            updatedOrder.status_history = updatedOrder.status_history || [];
            updatedOrder.status_history.push({ old_status: oldStatus, new_status: newOrderData.order_status, timestamp: currentTime, source: source });
            updatedOrder.order_status = newOrderData.order_status;
            changesDetected.push(`main_status: ${oldStatus} -> ${newOrderData.order_status}`);
            needsUpdate = true;
        }

        // 2. Update sub-order statuses
        const itemKey = updatedOrder.order_items ? 'order_items' : 'suborders';
        const newItemKey = newOrderData.order_items ? 'order_items' : (newOrderData.suborders ? 'suborders' : itemKey);

        if (newOrderData[newItemKey] && updatedOrder[itemKey]) {
            console.log(`${logPrefix} [2] Checking ${newOrderData[newItemKey].length} incoming sub-order(s)...`);
            newOrderData[newItemKey].forEach(newSub => {
                const subToUpdate = updatedOrder[itemKey].find(item => item.suborder_id === newSub.suborder_id);
                if (subToUpdate && newSub.item_status) {
                    console.log(`${logPrefix} [2a] Checking sub-order ${newSub.suborder_id}. DB: '${subToUpdate.item_status}', New: '${newSub.item_status}'`);
                    if (subToUpdate.item_status !== newSub.item_status) {
                        console.log(`${logPrefix} [2b] --> CHANGE DETECTED. Updating sub-order status and adding to history.`);
                        const oldSubStatus = subToUpdate.item_status;
                        subToUpdate.status_history = subToUpdate.status_history || [];
                        subToUpdate.status_history.push({ old_status: oldSubStatus, new_status: newSub.item_status, timestamp: currentTime, source: source });
                        subToUpdate.item_status = newSub.item_status;
                        changesDetected.push(`suborder_${newSub.suborder_id}_status: ${oldSubStatus} -> ${newSub.item_status}`);
                        needsUpdate = true;
                    }
                }
            });
        }
        
        // 3. Handle optional pushes (for returns)
        if (options.push) {
            console.log(`${logPrefix} [3] Optional 'push' data found. Adding to document.`);
            for (const key in options.push) {
                updatedOrder[key] = updatedOrder[key] || [];
                updatedOrder[key].push(options.push[key]);
                changesDetected.push(`pushed_data_to: ${key}`);
                needsUpdate = true;
            }
        }

        if (!needsUpdate) {
            console.log(`${logPrefix} --- No changes detected. Exiting without database write.`);
            return { success: true, action: 'no_change', changes: [] };
        }
        
        updatedOrder.last_updated = currentTime;
        
        console.log(`${logPrefix} Preparing to save document with changes: ${changesDetected.join('; ')}`);
        const { _id, ...docToUpdate } = updatedOrder;
        await collection.replaceOne({ _id: existingOrder._id }, docToUpdate);

        console.log(`${logPrefix} ✅ Synced order ${orderId}.`);
        return { success: true, action: 'updated', changes: changesDetected };

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error);
        throw error;
    }
};

/**
 * Webhook to create a new order.
 * It uses the smart syncOrderStatus function to ensure that a status
 * history is created from the very beginning.
 */
app.post('/webhook/create-order', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Create-Order-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- Payload Detection (No changes here) ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            console.log(`${logPrefix} Detected V2 payload format (JSON array).`);
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            console.log(`${logPrefix} Detected V1 payload format (Object with 'orders' key).`);
            ordersToProcess = req.body.orders;
        } else {
            console.error(`${logPrefix} ❌ Validation Failed: Invalid payload structure.`);
            return res.status(400).json({ message: "Bad Request: Invalid payload structure." });
        }

        if (ordersToProcess.length === 0) {
            console.warn(`${logPrefix} ⚠️ The 'orders' array is empty. Nothing to process.`);
            return res.status(200).json({ message: "Webhook received, but no orders were provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${ordersToProcess.length} order(s).`);

        // --- Use syncOrderStatus for each order ---
        const results = [];
        for (const orderData of ordersToProcess) {
            const orderId = parseInt(orderData.order_id, 10);
            
            if (isNaN(orderId)) {
                console.warn(`${logPrefix} ⚠️ Skipping an item due to invalid or missing 'order_id'.`);
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // Call the smart function. It will detect that the order doesn't exist
            // and create it with the initial status history.
            const syncResult = await syncOrderStatus(db, orderId, orderData, "create-order-webhook");
            results.push({ order_id: orderId, ...syncResult });
        }
        // --- End of processing loop ---

        const successfulCreations = results.filter(r => r.success && r.action === 'inserted').length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully created ${successfulCreations} new order(s).`);

        res.status(201).json({ 
            message: 'Webhook processed successfully.', 
            processedCount: results.length,
            createdCount: successfulCreations,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
            error: error.message 
        });
    }
});


/**
 * Webhook to confirm an order.
 * This route uses the central syncOrderStatus function to automatically find
 * and record all status changes for the order and its sub-orders.
 */
app.post('/webhook/confirm-order', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Confirm-Order-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- Payload Detection (Identical to other webhooks) ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            console.log(`${logPrefix} Detected V2 payload format (JSON array).`);
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            console.log(`${logPrefix} Detected V1 payload format (Object with 'orders' key).`);
            ordersToProcess = req.body.orders;
        } else {
            console.error(`${logPrefix} ❌ Validation Failed: Invalid payload structure.`);
            return res.status(400).json({ message: "Bad Request: Invalid payload structure." });
        }

        if (ordersToProcess.length === 0) {
            console.warn(`${logPrefix} ⚠️ The 'orders' array is empty. Nothing to process.`);
            return res.status(200).json({ message: "Webhook received, but no orders were provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${ordersToProcess.length} confirmed order(s).`);

        // --- Use syncOrderStatus for each order ---
        const results = [];
        for (const orderData of ordersToProcess) {
            const orderId = parseInt(orderData.order_id, 10);
            
            if (isNaN(orderId)) {
                console.warn(`${logPrefix} ⚠️ Skipping an item due to invalid or missing 'order_id'.`);
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // Call the smart function. It will automatically find all status changes
            // and update the database with a timestamped history.
            const syncResult = await syncOrderStatus(db, orderId, orderData, "confirm-order-webhook");
            results.push({ order_id: orderId, ...syncResult });
        }
        // --- End of processing loop ---

        const successfulUpdates = results.filter(r => r.success && r.action === 'updated').length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully updated ${successfulUpdates} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully.', 
            processedCount: results.length,
            updatedCount: successfulUpdates,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
            error: error.message 
        });
    }
});


/**
 * Webhook for when an order is ready to be dispatched.
 * This route uses the central syncOrderStatus function to automatically find
 * and record all status changes for the order and its sub-orders.
 */
app.post('/webhook/ready-to-dispatch', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Ready-To-Dispatch-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- Payload Detection (Identical to other webhooks) ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            console.log(`${logPrefix} Detected V2 payload format (JSON array).`);
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            console.log(`${logPrefix} Detected V1 payload format (Object with 'orders' key).`);
            ordersToProcess = req.body.orders;
        } else {
            console.error(`${logPrefix} ❌ Validation Failed: Invalid payload structure.`);
            return res.status(400).json({ message: "Bad Request: Invalid payload structure." });
        }

        if (ordersToProcess.length === 0) {
            console.warn(`${logPrefix} ⚠️ The 'orders' array is empty. Nothing to process.`);
            return res.status(200).json({ message: "Webhook received, but no orders were provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${ordersToProcess.length} order(s) marked as Ready to Dispatch.`);

        // --- Use syncOrderStatus for each order ---
        const results = [];
        for (const orderData of ordersToProcess) {
            const orderId = parseInt(orderData.order_id, 10);
            
            if (isNaN(orderId)) {
                console.warn(`${logPrefix} ⚠️ Skipping an item due to invalid or missing 'order_id'.`);
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // Call the smart function. It will automatically find all status changes
            // and update the database with a timestamped history.
            const syncResult = await syncOrderStatus(db, orderId, orderData, "ready-to-dispatch-webhook");
            results.push({ order_id: orderId, ...syncResult });
        }
        // --- End of processing loop ---

        const successfulUpdates = results.filter(r => r.success && r.action === 'updated').length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully updated ${successfulUpdates} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully.', 
            processedCount: results.length,
            updatedCount: successfulUpdates,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
            error: error.message 
        });
    }
});


/**
 * Webhook for when an order has been manifested.
 * This route uses the central syncOrderStatus function to automatically find
 * and record all status changes for the order and its sub-orders.
 */
app.post('/webhook/manifested', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Manifested-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- Payload Detection (Identical to other webhooks) ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            console.log(`${logPrefix} Detected V2 payload format (JSON array).`);
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            console.log(`${logPrefix} Detected V1 payload format (Object with 'orders' key).`);
            ordersToProcess = req.body.orders;
        } else {
            console.error(`${logPrefix} ❌ Validation Failed: Invalid payload structure.`);
            return res.status(400).json({ message: "Bad Request: Invalid payload structure." });
        }

        if (ordersToProcess.length === 0) {
            console.warn(`${logPrefix} ⚠️ The 'orders' array is empty. Nothing to process.`);
            return res.status(200).json({ message: "Webhook received, but no orders were provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${ordersToProcess.length} manifested order(s).`);

        // --- Use syncOrderStatus for each order ---
        const results = [];
        for (const orderData of ordersToProcess) {
            const orderId = parseInt(orderData.order_id, 10);
            
            if (isNaN(orderId)) {
                console.warn(`${logPrefix} ⚠️ Skipping an item due to invalid or missing 'order_id'.`);
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // Call the smart function. It will automatically find all status changes
            // and update the database with a timestamped history.
            const syncResult = await syncOrderStatus(db, orderId, orderData, "manifested-webhook");
            results.push({ order_id: orderId, ...syncResult });
        }
        // --- End of processing loop ---

        const successfulUpdates = results.filter(r => r.success && r.action === 'updated').length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully updated ${successfulUpdates} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully.', 
            processedCount: results.length,
            updatedCount: successfulUpdates,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
            error: error.message 
        });
    }
});




/**
 * Webhook for when an order is cancelled.
 * This route uses the central syncOrderStatus function to automatically find
 * and record all status changes for the order and its sub-orders.
 */
app.post('/webhook/cancel-order', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Cancel-Order-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- Payload Detection (Identical to other webhooks) ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            console.log(`${logPrefix} Detected V2 payload format (JSON array).`);
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            console.log(`${logPrefix} Detected V1 payload format (Object with 'orders' key).`);
            ordersToProcess = req.body.orders;
        } else {
            console.error(`${logPrefix} ❌ Validation Failed: Invalid payload structure.`);
            return res.status(400).json({ message: "Bad Request: Invalid payload structure." });
        }

        if (ordersToProcess.length === 0) {
            console.warn(`${logPrefix} ⚠️ The 'orders' array is empty. Nothing to process.`);
            return res.status(200).json({ message: "Webhook received, but no orders were provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${ordersToProcess.length} cancelled order(s).`);

        // --- Use syncOrderStatus for each order ---
        const results = [];
        for (const orderData of ordersToProcess) {
            const orderId = parseInt(orderData.order_id, 10);
            
            if (isNaN(orderId)) {
                console.warn(`${logPrefix} ⚠️ Skipping an item due to invalid or missing 'order_id'.`);
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // Call the smart function. It will automatically find all status changes
            // and update the database with a timestamped history.
            const syncResult = await syncOrderStatus(db, orderId, orderData, "cancel-order-webhook");
            results.push({ order_id: orderId, ...syncResult });
        }
        // --- End of processing loop ---

        const successfulUpdates = results.filter(r => r.success && r.action === 'updated').length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully updated ${successfulUpdates} order(s).`);

        res.status(200).json({ 
            message: 'Webhook processed successfully.', 
            processedCount: results.length,
            updatedCount: successfulUpdates,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
            error: error.message 
        });
    }
});


/**
 * Webhook for when an item is marked for return.
 * This webhook now uses the enhanced syncOrderStatus function to handle everything
 * in a single, efficient database operation.
 */
app.post('/webhook/mark-return', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Mark-Return-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- Payload Detection for Returns (No change here) ---
        let creditNotesToProcess;
        if (Array.isArray(req.body) && req.body.length > 0 && Array.isArray(req.body[0])) {
            creditNotesToProcess = req.body[0];
        } else if (req.body && Array.isArray(req.body.credit_notes)) {
            creditNotesToProcess = req.body.credit_notes;
        } else {
            return res.status(400).json({ message: "Bad Request: Invalid return payload structure." });
        }

        if (!creditNotesToProcess || creditNotesToProcess.length === 0) {
            return res.status(200).json({ message: "Webhook received, but no credit notes were provided." });
        }

        console.log(`${logPrefix} ➡️  Processing ${creditNotesToProcess.length} return credit note(s).`);
        const results = [];

        for (const creditNote of creditNotesToProcess) {
            const orderId = parseInt(creditNote.order_id, 10);
            if (isNaN(orderId)) {
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // The 'creditNote' itself doesn't represent the full new state of the order,
            // so we create a simple object representing the change we want to see.
            // The syncOrderStatus function will handle the rest.
            const desiredOrderState = {
                order_id: orderId,
                order_status: "Returned", // The new top-level status
                // We also need to reflect the sub-order status change
                order_items: creditNote.items.map(item => ({
                    suborder_id: item.suborder_id,
                    item_status: "Returned"
                }))
            };

            // Call the enhanced function, passing the creditNote in the options
            const syncResult = await syncOrderStatus(
                db, 
                orderId, 
                desiredOrderState, 
                "mark-return-webhook",
                { push: { returns: creditNote } } // This is the new, powerful part
            );
            
            results.push({ order_id: orderId, ...syncResult });
        }
        
        const successfulUpdates = results.filter(r => r.success).length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully processed ${successfulUpdates} return(s).`);

        res.status(200).json({
            message: 'Return webhook processed successfully.',
            processedCount: results.length,
            updatedCount: successfulUpdates,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ message: 'Failed to process webhook.', error: error.message });
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
 * Webhook for real-time order tracking updates from a carrier.
 * This uses the universal syncOrderStatus function to update the specific sub-order's
 * status, log its history, and embed the latest tracking data—all in one call.
 */
app.post('/webhook/order-tracking', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Order-Tracking-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        const trackingUpdates = Array.isArray(req.body) ? req.body : [req.body];

        if (trackingUpdates.length === 0) {
            return res.status(200).json({ message: "Webhook received, but no tracking data was provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${trackingUpdates.length} tracking update(s).`);
        const results = [];

        for (const update of trackingUpdates) {
            const orderId = parseInt(update.orderId, 10);
            const subOrderId = parseInt(update.suborder_id, 10);
            const newStatus = update.currentShippingStatus;

            if (isNaN(orderId) || isNaN(subOrderId) || !newStatus) {
                results.push({ success: false, error: "Invalid tracking data" });
                continue;
            }

            // Create the "desired state" object for the status change
            const desiredOrderState = {
                order_id: orderId,
                order_items: [{ // Use V2 'order_items' key for consistency
                    suborder_id: subOrderId,
                    item_status: newStatus
                }]
            };
            
            // Create the options object to embed the full tracking payload
            const options = {
                set: {
                    // This uses MongoDB's arrayFilters syntax to target the correct sub-order
                    'order_items.$[elem].tracking_data': update
                }
            };

            // Call the universal function with both the state change and the extra data
            const syncResult = await syncOrderStatus(db, orderId, desiredOrderState, "order-tracking-webhook", options);
            results.push({ order_id: orderId, suborder_id: subOrderId, ...syncResult });
        }
        
        const successfulUpdates = results.filter(r => r.success).length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully processed ${successfulUpdates} tracking update(s).`);

        res.status(200).json({ 
            message: 'Tracking webhook processed successfully.', 
            processedCount: results.length,
            updatedCount: successfulUpdates,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
            error: error.message 
        });
    }
});



/**
 * Webhook to process new orders fetched from a marketplace.
 * This route uses the central syncOrderStatus function to create the new
 * order, ensuring a status history is generated from the very beginning.
 */
app.post('/webhook/fetch-orders', authenticateWebhook, async (req, res) => {
    const logPrefix = "[Fetch-Orders-Webhook]";
    try {
        console.log(`\n${logPrefix} ---> Authenticated request received.`);

        // --- INTELLIGENT PAYLOAD DETECTION ---
        let ordersToProcess;
        if (Array.isArray(req.body)) {
            // This is a V2 payload (raw array)
            console.log(`${logPrefix} Detected V2 payload format (JSON array).`);
            ordersToProcess = req.body;
        } else if (req.body && Array.isArray(req.body.orders)) {
            // This is a V1 payload (object with an 'orders' key)
            console.log(`${logPrefix} Detected V1 payload format (Object with 'orders' key).`);
            ordersToProcess = req.body.orders;
        } else {
            console.error(`${logPrefix} ❌ Validation Failed: Invalid payload structure.`);
            return res.status(400).json({ message: "Bad Request: Invalid payload structure." });
        }

        if (ordersToProcess.length === 0) {
            console.warn(`${logPrefix} ⚠️ The 'orders' array is empty. Nothing to process.`);
            return res.status(200).json({ message: "Webhook received, but no orders were provided." });
        }
        
        console.log(`${logPrefix} ➡️  Processing ${ordersToProcess.length} fetched order(s).`);

        // --- Use syncOrderStatus for each order ---
        const results = [];
        for (const orderData of ordersToProcess) {
            const orderId = parseInt(orderData.order_id, 10);
            
            if (isNaN(orderId)) {
                console.warn(`${logPrefix} ⚠️ Skipping an item due to invalid or missing 'order_id'.`);
                results.push({ success: false, error: "Invalid order_id" });
                continue;
            }

            // Call the smart function. It will detect that the order doesn't exist
            // and create it with the initial status history.
            const syncResult = await syncOrderStatus(db, orderId, orderData, "fetch-orders-webhook");
            results.push({ order_id: orderId, ...syncResult });
        }
        // --- End of processing loop ---

        const successfulCreations = results.filter(r => r.success && r.action === 'inserted').length;
        console.log(`${logPrefix} ✅  Processing complete. Successfully created ${successfulCreations} new order(s).`);

        res.status(201).json({ 
            message: 'Webhook processed successfully.', 
            processedCount: results.length,
            createdCount: successfulCreations,
            details: results
        });

    } catch (error) {
        console.error(`${logPrefix} ❌ An unexpected error occurred:`, error.message);
        res.status(500).json({ 
            message: 'Failed to process webhook due to a server error.', 
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
