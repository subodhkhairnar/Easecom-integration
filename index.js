
// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3007;
app.use(bodyParser.json());

// MongoDB connections
let db; // Production database
let devDb; // Development database

const connectMongoDB = async () => {
  try {
    // Production database connection
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('easecom_integration'); // Production database
    console.log('✅ Connected to MongoDB - easecom_integration database (Production)');
    
    // Development database connection (if MONGODB_DEV_URI is provided)
    if (process.env.MONGODB_DEV_URI) {
      const devClient = new MongoClient(process.env.MONGODB_DEV_URI);
      await devClient.connect();
      devDb = devClient.db('easecom_integration_dev'); // Development database
      console.log('✅ Connected to MongoDB - easecom_integration_dev database (Development)');
    } else {
      console.log('⚠️ MONGODB_DEV_URI not provided, using production database for dev');
      devDb = db; // Fallback to production database
    }
    
    return { db, devDb };
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Load integrations
const easyEcom = require('./integrations/easyecom');
const clickPost = require('./integrations/clickpost');
const clickPostDev = require('./integrations/clickpost-dev');


// Initialize integrations with DB
const startServer = async () => {
  const { db: prodDb, devDb } = await connectMongoDB();
  
  // Initialize production integrations
  easyEcom.init(prodDb);
  clickPost.init(prodDb);
  
  // Initialize development integrations
  clickPostDev.init(devDb);

  // Mount integration routes
  app.use('/integrations/easyecom', easyEcom.router);
  app.use('/integrations/clickpost', clickPost.router);
  app.use('/integrations/clickpost-dev', clickPostDev.router);
  

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ success: true, message: 'Server is running' });
  });

  app.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
    console.log('Available routes:');
    console.log('  EasyEcom: /integrations/easyecom/pull-data, /integrations/easyecom/get-saved-orders, etc.');
    console.log('  ClickPost: /integrations/clickpost/webhook/orders, /integrations/clickpost/status/update');
    console.log('  ClickPost Dev: /integrations/clickpost-dev/dev/webhook/orders, /integrations/clickpost-dev/dev/status/update');
  });
};

startServer().catch(console.error);