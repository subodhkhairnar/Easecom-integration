# ClickPost Development Database Architecture

## 🏗️ **Database Separation Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                        APPLICATION SERVER                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   EasyEcom      │  │   ClickPost     │  │  ClickPost Dev  │  │
│  │   (Production)  │  │   (Production)  │  │  (Development)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATABASE LAYER                           │
│                                                                 │
│  ┌─────────────────────────────────┐  ┌─────────────────────┐   │
│  │      PRODUCTION DATABASE        │  │   DEVELOPMENT DB    │   │
│  │                                 │  │                     │   │
│  │  Database: easecom_integration  │  │  Database: easecom_integration_dev │
│  │  ┌─────────────────────────────┐ │  │  ┌─────────────────┐ │   │
│  │  │ Collections:                │ │  │  │ Collections:    │ │   │
│  │  │ • easyecom_orders           │ │  │  │ • clickpost_dev_orders │ │
│  │  │ • clickpost_orders          │ │  │  │                 │ │   │
│  │  └─────────────────────────────┘ │  │  └─────────────────┘ │   │
│  └─────────────────────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 **How It Works**

### **1. Environment Variables Setup**

```bash
# Production Database
MONGODB_URI=mongodb://localhost:27017/easecom_integration

# Development Database (Separate)
MONGODB_DEV_URI=mongodb://localhost:27017/easecom_integration_dev
```

### **2. Database Connection Logic**

```javascript
// Production database connection
const client = new MongoClient(process.env.MONGODB_URI);
db = client.db('easecom_integration');

// Development database connection
const devClient = new MongoClient(process.env.MONGODB_DEV_URI);
devDb = devClient.db('easecom_integration_dev');
```

### **3. Collection Usage**

#### **Production Collections:**
- `easyecom_orders` - EasyEcom production orders
- `clickpost_orders` - ClickPost production orders

#### **Development Collections:**
- `clickpost_dev_orders` - ClickPost development orders

## 📊 **Data Flow Examples**

### **Production ClickPost Order Creation:**
```
POST /integrations/clickpost/webhook/orders
    ↓
Uses: MONGODB_URI
Database: easecom_integration
Collection: clickpost_orders
```

### **Development ClickPost Order Creation:**
```
POST /integrations/clickpost-dev/dev/webhook/orders
    ↓
Uses: MONGODB_DEV_URI
Database: easecom_integration_dev
Collection: clickpost_dev_orders
```

## 🔄 **Database Initialization Process**

1. **Server Starts** → `connectMongoDB()` is called
2. **Production DB** → Connects to `MONGODB_URI`
3. **Development DB** → Connects to `MONGODB_DEV_URI` (if provided)
4. **Fallback** → If `MONGODB_DEV_URI` not provided, uses production DB
5. **Integration Init** → Each integration gets its appropriate database

## 🛡️ **Benefits of This Architecture**

### **✅ Data Isolation**
- Development data never affects production
- Safe testing without production data corruption
- Independent data sets for different environments

### **✅ Environment Safety**
- Production data remains secure
- Development experiments are isolated
- Easy to reset development data

### **✅ Scalability**
- Can use different database servers
- Different performance configurations
- Separate backup strategies

## 🔧 **Configuration Examples**

### **Same Server, Different Databases:**
```bash
MONGODB_URI=mongodb://localhost:27017/easecom_integration
MONGODB_DEV_URI=mongodb://localhost:27017/easecom_integration_dev
```

### **Different Servers:**
```bash
MONGODB_URI=mongodb://prod-server:27017/easecom_integration
MONGODB_DEV_URI=mongodb://dev-server:27017/easecom_integration_dev
```

### **MongoDB Atlas (Cloud):**
```bash
MONGODB_URI=mongodb+srv://user:pass@prod-cluster.mongodb.net/easecom_integration
MONGODB_DEV_URI=mongodb+srv://user:pass@dev-cluster.mongodb.net/easecom_integration_dev
```

## 📝 **Code Implementation**

### **In clickpost-dev.js:**
```javascript
// All database operations use devDb
const collection = db.collection('clickpost_dev_orders');
```

### **In clickpost.js:**
```javascript
// All database operations use prodDb
const collection = db.collection('clickpost_orders');
```

## 🚀 **Deployment Scenarios**

### **Development Environment:**
- Uses `MONGODB_DEV_URI`
- All dev routes use development database
- Safe for testing and experimentation

### **Production Environment:**
- Uses `MONGODB_URI`
- All production routes use production database
- Data integrity maintained

### **Staging Environment:**
- Can use either database based on configuration
- Flexible environment setup

## 🔍 **Monitoring & Debugging**

### **Console Logs:**
```
✅ Connected to MongoDB - easecom_integration database (Production)
✅ Connected to MongoDB - easecom_integration_dev database (Development)
```

### **Database Queries:**
- Production: `db.clickpost_orders.find()`
- Development: `db.clickpost_dev_orders.find()`

## ⚠️ **Important Notes**

1. **Always use separate databases** for production and development
2. **Never mix data** between environments
3. **Test thoroughly** in development before production deployment
4. **Monitor database connections** to ensure proper separation
5. **Backup both databases** independently
6. **Use environment-specific credentials** for security
