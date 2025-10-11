# Database Structure - Easecom Integration Project

## 🏗️ **Updated Database Names**

### **Production Database:**
- **Name:** `easecom_integration`
- **Collections:**
  - `easyecom_orders` - EasyEcom production orders
  - `clickpost_orders` - ClickPost production orders

### **Development Database:**
- **Name:** `easecom_integration_dev`
- **Collections:**
  - `clickpost_dev_orders` - ClickPost development orders

## 🔧 **Environment Variables**

```bash
# Production Database
MONGODB_URI=mongodb://localhost:27017/easecom_integration

# Development Database
MONGODB_DEV_URI=mongodb://localhost:27017/easecom_integration_dev
```

## 📊 **Database Architecture**

```
┌─────────────────────────────────────────────────────────────┐
│                    EASECOM INTEGRATION                      │
│                                                             │
│  ┌─────────────────┐              ┌─────────────────┐       │
│  │   PRODUCTION    │              │   DEVELOPMENT   │       │
│  │                 │              │                 │       │
│  │ Database:       │              │ Database:       │       │
│  │ easecom_integration            │ easecom_integration_dev │
│  │                 │              │                 │       │
│  │ Collections:    │              │ Collections:    │       │
│  │ • easyecom_orders              │ • clickpost_dev_orders  │
│  │ • clickpost_orders             │                 │       │
│  └─────────────────┘              └─────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 **Connection Flow**

### **1. Server Startup:**
```javascript
// Production connection
const client = new MongoClient(process.env.MONGODB_URI);
db = client.db('easecom_integration');

// Development connection
const devClient = new MongoClient(process.env.MONGODB_DEV_URI);
devDb = devClient.db('easecom_integration_dev');
```

### **2. Integration Initialization:**
```javascript
// Production integrations
easyEcom.init(prodDb);      // Uses: easecom_integration
clickPost.init(prodDb);     // Uses: easecom_integration

// Development integrations
clickPostDev.init(devDb);   // Uses: easecom_integration_dev
```

## 📝 **Collection Usage**

### **Production Routes:**
- `/integrations/easyecom/*` → `easecom_integration.easyecom_orders`
- `/integrations/clickpost/*` → `easecom_integration.clickpost_orders`

### **Development Routes:**
- `/integrations/clickpost-dev/dev/*` → `easecom_integration_dev.clickpost_dev_orders`

## 🔍 **Console Output**

When the server starts, you'll see:
```
✅ Connected to MongoDB - easecom_integration database (Production)
✅ Connected to MongoDB - easecom_integration_dev database (Development)
```

## 🛡️ **Benefits of This Structure**

### **✅ Clear Naming Convention:**
- Database names clearly indicate the project (`easecom_integration`)
- Development databases have `_dev` suffix
- Easy to identify and manage

### **✅ Project-Specific:**
- No generic names like `meta_ads`
- Reflects the actual project purpose
- Professional and maintainable

### **✅ Environment Separation:**
- Complete isolation between prod and dev
- Safe testing environment
- Easy to reset development data

## 🔧 **MongoDB Commands**

### **Production Database:**
```javascript
// Switch to production database
use easecom_integration

// View collections
show collections
// Output: easyecom_orders, clickpost_orders

// Query ClickPost orders
db.clickpost_orders.find()
```

### **Development Database:**
```javascript
// Switch to development database
use easecom_integration_dev

// View collections
show collections
// Output: clickpost_dev_orders

// Query ClickPost dev orders
db.clickpost_dev_orders.find()
```

## 📋 **Deployment Checklist**

- ✅ Database names updated to project-specific names
- ✅ Environment variables configured
- ✅ Production and development databases separated
- ✅ Collections properly named
- ✅ Integration routes mapped to correct databases
- ✅ Console logging updated
- ✅ Documentation updated

## 🎯 **Summary**

The database structure now uses:
- **Production:** `easecom_integration` database
- **Development:** `easecom_integration_dev` database
- **Clear naming convention** that reflects the project purpose
- **Complete separation** between production and development environments
- **Professional structure** that's easy to understand and maintain
