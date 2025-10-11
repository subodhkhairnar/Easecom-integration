# Environment Variables Configuration

## Overview
This document outlines all the environment variables needed for the Easecom Integration project, including support for both production and development instances.

## Quick Setup
1. Copy the variables below to your `.env` file
2. Replace placeholder values with your actual credentials
3. Never commit the `.env` file to version control

## Required Environment Variables

### Server Configuration
```bash
PORT=3007
NODE_ENV=development
```

### MongoDB Configuration
```bash
# Production Database
MONGODB_URI=mongodb://localhost:27017/easecom_integration
# Alternative: MongoDB Atlas
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/easecom_integration?retryWrites=true&w=majority

# Development Database (Optional - can use same as production)
MONGODB_DEV_URI=mongodb://localhost:27017/easecom_integration_dev
```

### EasyEcom Integration
```bash
EASYECOM_API_URL=https://api.easyecom.com
EASYECOM_API_KEY=your_easyecom_api_key_here
EASYECOM_EMAIL=your_email@example.com
EASYECOM_PASSWORD=your_easyecom_password
EASYECOM_LOCATION_KEY=your_location_key_here
```

### ClickPost Integration - Production
```bash
CLICKPOST_USERNAME=your_clickpost_username
CLICKPOST_API_KEY=your_clickpost_api_key
CLICKPOST_ACCOUNT_CODE=your_clickpost_account_code
CLICKPOST_BASE_URL=https://api.clickpost.in
CLICKPOST_WEBHOOK_TOKEN=your_clickpost_webhook_token
```

### ClickPost Integration - Development
```bash
# Use different credentials for development/testing
CLICKPOST_DEV_USERNAME=your_clickpost_dev_username
CLICKPOST_DEV_API_KEY=your_clickpost_dev_api_key
CLICKPOST_DEV_ACCOUNT_CODE=your_clickpost_dev_account_code
CLICKPOST_DEV_BASE_URL=https://api-dev.clickpost.in
CLICKPOST_DEV_WEBHOOK_TOKEN=your_clickpost_dev_webhook_token
```

### Security & Authentication
```bash
JWT_SECRET=your_jwt_secret_key_here
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Logging & Monitoring
```bash
LOG_LEVEL=info
ENABLE_DEBUG_LOGGING=true
```

### Feature Flags
```bash
ENABLE_EASYECOM=true
ENABLE_CLICKPOST=true
ENABLE_CLICKPOST_DEV=true
ENABLE_WEBHOOKS=true
ENABLE_API_RATE_LIMITING=true
ENABLE_REQUEST_LOGGING=true
```

### Development Settings
```bash
DEV_MODE=true
DEV_SKIP_AUTH=false
DEV_MOCK_EXTERNAL_APIS=false
```

### Production Settings
```bash
PROD_MODE=false
PROD_SKIP_AUTH=false
PROD_MOCK_EXTERNAL_APIS=false
```

### Database Collections
```bash
# Production Collections
COLLECTION_EASYECOM_ORDERS=easyecom_orders
COLLECTION_CLICKPOST_ORDERS=clickpost_orders

# Development Collections
COLLECTION_EASYECOM_DEV_ORDERS=easyecom_dev_orders
COLLECTION_CLICKPOST_DEV_ORDERS=clickpost_dev_orders
```

### Webhook Configuration
```bash
WEBHOOK_BASE_URL_PRODUCTION=https://your-domain.com
WEBHOOK_BASE_URL_DEVELOPMENT=https://your-dev-domain.com
WEBHOOK_TIMEOUT_MS=30000
WEBHOOK_RETRY_ATTEMPTS=3
```

### External Services
```bash
# Email Service
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password
```

### Performance & Optimization
```bash
DB_POOL_SIZE=10
DB_POOL_MIN=2
DB_POOL_MAX=20
API_TIMEOUT=30000
API_RETRY_ATTEMPTS=3
API_RETRY_DELAY=1000
CACHE_ENABLED=true
CACHE_TTL=3600
CACHE_MAX_SIZE=1000
```

### Testing & Debugging
```bash
TEST_MODE=false
TEST_DATABASE_URL=mongodb://localhost:27017/easecom_integration_test
MOCK_EXTERNAL_SERVICES=false
DEBUG_MODE=false
DEBUG_DATABASE_QUERIES=false
DEBUG_API_CALLS=false
DEBUG_WEBHOOK_CALLS=false
```

## Environment-Specific Overrides

### Production Environment
When `NODE_ENV=production`:
```bash
LOG_LEVEL=warn
ENABLE_DEBUG_LOGGING=false
DEV_MODE=false
PROD_MODE=true
```

### Development Environment
When `NODE_ENV=development`:
```bash
LOG_LEVEL=debug
ENABLE_DEBUG_LOGGING=true
DEV_MODE=true
PROD_MODE=false
```

## Important Notes

1. **Security**: Never commit your `.env` file to version control
2. **Credentials**: Use different credentials for development and production
3. **Database**: Use separate databases for dev and prod to avoid conflicts
4. **API Keys**: Keep your API keys secure and rotate them regularly
5. **Testing**: Test all integrations in development before deploying to production
6. **Monitoring**: Set up alerts for unusual API activity
7. **Backup**: Regularly backup your database and test restore procedures
8. **HTTPS**: Use HTTPS in production for all webhook endpoints
9. **Error Handling**: Implement proper error handling and logging for all integrations
10. **Documentation**: Keep this file updated as you add new environment variables

## Database Collections Used

### Production Collections
- `easyecom_orders` - EasyEcom orders
- `clickpost_orders` - ClickPost orders

### Development Collections
- `easyecom_dev_orders` - EasyEcom dev orders
- `clickpost_dev_orders` - ClickPost dev orders

## Integration Endpoints

### Production Endpoints
- EasyEcom: `/integrations/easyecom/*`
- ClickPost: `/integrations/clickpost/*`

### Development Endpoints
- ClickPost Dev: `/integrations/clickpost-dev/dev/*`

## Webhook URLs

### Production Webhooks
- ClickPost Orders: `https://your-domain.com/integrations/clickpost/webhook/orders`
- ClickPost Status: `https://your-domain.com/integrations/clickpost/status/update`

### Development Webhooks
- ClickPost Dev Orders: `https://your-domain.com/integrations/clickpost-dev/dev/webhook/orders`
- ClickPost Dev Status: `https://your-domain.com/integrations/clickpost-dev/dev/status/update`
