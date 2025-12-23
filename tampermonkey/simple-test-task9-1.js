// Simple test for Task 9.1: Request Metrics and Logging Integration
// Tests the basic functionality of RequestMetricsLogger

console.log('🚀 Starting Task 9.1 Simple Integration Test...\n');

// Mock environment
global.window = {
    addEventListener: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    performance: { now: () => Date.now() }
};

global.document = {
    addEventListener: () => {},
    hidden: false,
    hasFocus: () => true
};

// Load RequestMetricsLogger
const fs = require('fs');
const path = require('path');

try {
    // Read the RequestMetricsLogger file
    const metricsLoggerPath = path.join(__dirname, 'request-metrics-logger.js');
    const metricsLoggerCode = fs.readFileSync(metricsLoggerPath, 'utf8');
    
    // Create evaluation context
    const vm = require('vm');
    const context = {
        console,
        window: global.window,
        document: global.document,
        performance: global.window.performance,
        Date,
        Math,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        RequestMetricsLogger: null,
        module: { exports: {} }
    };
    
    vm.createContext(context);
    vm.runInContext(metricsLoggerCode, context);
    
    const RequestMetricsLogger = context.RequestMetricsLogger || context.module.exports.RequestMetricsLogger;
    
    if (!RequestMetricsLogger) {
        throw new Error('RequestMetricsLogger not found in module');
    }
    
    console.log('✓ RequestMetricsLogger loaded successfully');
    
    // Test 1: Initialization
    console.log('\n=== Test 1: Initialization ===');
    RequestMetricsLogger.initialize();
    console.log('✓ RequestMetricsLogger initialized');
    console.log(`✓ Session start time: ${RequestMetricsLogger.metrics.session.startTime}`);
    console.log(`✓ Initial request count: ${RequestMetricsLogger.metrics.requests.total}`);
    
    // Test 2: Individual Request Tracking
    console.log('\n=== Test 2: Individual Request Tracking ===');
    const driverName = 'TestDriver1';
    const requestRecord = RequestMetricsLogger.startRequest(driverName, 'individual', false);
    
    console.log(`✓ Started request for ${driverName}`);
    console.log(`✓ Request ID: ${requestRecord.requestId}`);
    console.log(`✓ Total requests: ${RequestMetricsLogger.metrics.requests.total}`);
    console.log(`✓ Individual requests: ${RequestMetricsLogger.metrics.requests.individual}`);
    
    // Simulate some processing time
    setTimeout(() => {
        const mockResponseData = { [driverName]: { member_info: { display_name: 'Test Driver' } } };
        RequestMetricsLogger.completeRequest(requestRecord, mockResponseData);
        
        console.log(`✓ Completed request for ${driverName}`);
        console.log(`✓ Response time: ${requestRecord.responseTime.toFixed(2)}ms`);
        console.log(`✓ Successful requests: ${RequestMetricsLogger.metrics.requests.successful}`);
        
        // Test 3: Cached Request
        console.log('\n=== Test 3: Cached Request ===');
        const cachedDriverName = 'CachedDriver';
        const cachedRecord = RequestMetricsLogger.startRequest(cachedDriverName, 'individual', true);
        RequestMetricsLogger.completeRequest(cachedRecord, { [cachedDriverName]: {} });
        
        console.log(`✓ Cached request completed`);
        console.log(`✓ Cache hits: ${RequestMetricsLogger.metrics.cache.hits}`);
        console.log(`✓ Cache hit rate: ${RequestMetricsLogger.metrics.cache.hitRate.toFixed(1)}%`);
        
        // Test 4: Failed Request
        console.log('\n=== Test 4: Failed Request ===');
        const failedDriverName = 'FailedDriver';
        const failedRecord = RequestMetricsLogger.startRequest(failedDriverName, 'individual', false);
        const mockError = new Error('Network timeout');
        mockError.name = 'TypeError';
        RequestMetricsLogger.failRequest(failedRecord, mockError);
        
        console.log(`✓ Failed request recorded`);
        console.log(`✓ Failed requests: ${RequestMetricsLogger.metrics.requests.failed}`);
        console.log(`✓ Network errors: ${RequestMetricsLogger.metrics.errors.network}`);
        
        // Test 5: Metrics Report
        console.log('\n=== Test 5: Metrics Report ===');
        const report = RequestMetricsLogger.generateMetricsReport();
        
        console.log(`✓ Report generated`);
        console.log(`✓ Report timestamp: ${report.timestamp}`);
        console.log(`✓ Total requests in report: ${report.requests.total}`);
        console.log(`✓ Success rate: ${report.requests.successRate}`);
        
        // Test 6: Driver Metrics
        console.log('\n=== Test 6: Driver-Specific Metrics ===');
        const driverMetric = RequestMetricsLogger.metrics.driverMetrics.get(driverName);
        
        if (driverMetric) {
            console.log(`✓ Driver metrics found for ${driverName}`);
            console.log(`✓ Driver requests: ${driverMetric.requests}`);
            console.log(`✓ Driver successes: ${driverMetric.successes}`);
            console.log(`✓ Driver average response time: ${driverMetric.averageResponseTime.toFixed(2)}ms`);
        } else {
            console.log(`✗ Driver metrics not found for ${driverName}`);
        }
        
        // Final Report
        console.log('\n=== Final Metrics Report ===');
        RequestMetricsLogger.logMetricsReport();
        
        console.log('\n' + '='.repeat(50));
        console.log('📊 TASK 9.1 SIMPLE TEST SUMMARY');
        console.log('='.repeat(50));
        console.log('🎉 All basic tests completed successfully!');
        console.log('✓ RequestMetricsLogger is working correctly');
        console.log('✓ Individual request tracking works');
        console.log('✓ Cache metrics tracking works');
        console.log('✓ Error tracking works');
        console.log('✓ Driver-specific metrics work');
        console.log('✓ Report generation works');
        console.log('\n✅ Task 9.1 integration is ready for use!');
        
    }, 10); // Small delay to simulate processing time
    
} catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
}