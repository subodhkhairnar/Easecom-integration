
// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.json());

// MongoDB connection
let db;
const connectMongoDB = async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('meta_ads'); // Database name from your URI
    console.log('✅ Connected to MongoDB - meta_ads database');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Load integrations
const easyEcom = require('./integrations/easyecom');
const clickPost = require('./integrations/clickpost');

// Initialize integrations with DB
const startServer = async () => {
  await connectMongoDB();
  easyEcom.init(db);
  clickPost.init(db);

  // Mount integration routes
  app.use('/integrations/easyecom', easyEcom.router);
  app.use('/integrations/clickpost', clickPost.router);

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ success: true, message: 'Server is running' });
  });

  app.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
    console.log('Available routes:');
    console.log('  EasyEcom: /integrations/easyecom/pull-data, /integrations/easyecom/get-saved-orders, etc.');
    console.log('  ClickPost: /integrations/clickpost/webhook/orders, /integrations/clickpost/status/update');
  });
};

startServer().catch(console.error);