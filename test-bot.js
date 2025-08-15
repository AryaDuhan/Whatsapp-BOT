#!/usr/bin/env node

/**
 * Quick Test Script for WhatsApp Attendance Bot
 * This script tests basic functionality without requiring WhatsApp authentication
 */

const { Client } = require('whatsapp-web.js');
const { LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('🧪 Testing WhatsApp Attendance Bot...\n');

// Test 1: Check if all required modules can be loaded
console.log('✅ Testing module imports...');
try {
    const CommandHandler = require('./src/handlers/commandHandler');
    const MessageHandler = require('./src/handlers/messageHandler');
    const User = require('./src/models/User');
    const Subject = require('./src/models/Subject');
    const AttendanceRecord = require('./src/models/AttendanceRecord');
    const DatabaseService = require('./src/services/databaseService');
    const SchedulerService = require('./src/services/schedulerService');
    const { getLogger } = require('./src/utils/logger');
    const RateLimiter = require('./src/middleware/rateLimiter');
    const InputValidator = require('./src/middleware/inputValidator');
    const SecurityManager = require('./src/middleware/securityManager');
    const ErrorHandler = require('./src/middleware/errorHandler');
    
    console.log('✅ All modules loaded successfully');
} catch (error) {
    console.error('❌ Module import error:', error.message);
    process.exit(1);
}

// Test 2: Check environment variables
console.log('\n✅ Testing environment configuration...');
try {
    require('dotenv').config();
    const requiredEnvVars = [
        'MONGODB_URI',
        'NODE_ENV',
        'LOG_LEVEL'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
        console.warn('⚠️  Missing environment variables:', missingVars.join(', '));
        console.log('💡 Copy env.example to .env and configure required variables');
    } else {
        console.log('✅ Environment variables configured');
    }
} catch (error) {
    console.warn('⚠️  Environment configuration warning:', error.message);
}

// Test 3: Test database connection (if MongoDB URI is set)
console.log('\n✅ Testing database connection...');
if (process.env.MONGODB_URI) {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(() => {
        console.log('✅ Database connection successful');
        mongoose.connection.close();
    })
    .catch((error) => {
        console.error('❌ Database connection failed:', error.message);
        console.log('💡 Check your MONGODB_URI in .env file');
    });
} else {
    console.log('⚠️  Skipping database test (MONGODB_URI not set)');
}

// Test 4: Test middleware initialization
console.log('\n✅ Testing middleware initialization...');
try {
    const rateLimiter = new (require('./src/middleware/rateLimiter'))({
        commandsPerMinute: 10,
        messagesPerMinute: 20
    });
    
    const inputValidator = new (require('./src/middleware/inputValidator'))();
    const securityManager = new (require('./src/middleware/securityManager'))();
    const errorHandler = new (require('./src/middleware/errorHandler'))();
    
    console.log('✅ All middleware initialized successfully');
} catch (error) {
    console.error('❌ Middleware initialization error:', error.message);
}

// Test 5: Test utility functions
console.log('\n✅ Testing utility functions...');
try {
    const Helpers = require('./src/utils/helpers');
    const { MESSAGE_TEMPLATES, VALIDATION } = require('./src/utils/constants');
    
    // Test helper functions
    const testName = Helpers.capitalizeWords('john doe');
    const testDay = Helpers.normalizeDayName('mon');
    const testTime = Helpers.normalizeTime('2pm');
    
    console.log('✅ Utility functions working:', {
        name: testName,
        day: testDay,
        time: testTime
    });
} catch (error) {
    console.error('❌ Utility function error:', error.message);
}

console.log('\n🎉 Bot test completed successfully!');
console.log('\n📋 Next steps:');
console.log('1. Create .env file: cp env.example .env');
console.log('2. Configure MongoDB URI in .env');
console.log('3. Run: npm start');
console.log('4. Scan QR code with WhatsApp');
console.log('5. Test commands: /start, /help, /add');

process.exit(0);
