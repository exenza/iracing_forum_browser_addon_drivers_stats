// Test file for Task 9.1: Request Metrics and Logging Integration
// Tests the integration of RequestMetricsLogger with the concurrent request system

// Mock DOM environment for testing
const mockDOM = {
    createElement: () => ({ appendChild: () => {}, innerHTML: '', style: {} }),
    getElementsByTagName: () => [{ appendChild: () => {} }],
    getElementsByClassName: () => [],
    addEventListener: () => {},
    readyState: 'complete',
    hidden: false,
    hasFocus: () => true
};

// Mock window environment
const mockWindow = {
    addEventListener: () => {},
    sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    performance: {
        now: () => Date.now()
    }
};

// Mock console for testing
const originalConsole = console;
const mockConsole = {
    log: (...args) => originalConsole.log('[TEST]', ...args),
    warn: (...args) => originalConsole.warn('[TEST]', ...args),
    error: (...args) => originalConsole.error('[TEST]', ...args),
    info: (...args) => originalConsole.info('[TEST]', ...args),
    debug: (...args) => originalConsole.debug('[TEST]', ...args)
};

// Set up global mocks
global.document = mockDOM;
global.window = mockWindow;
global.console = mockConsole;

// Load the RequestMetricsLogger
const fs = require('fs');
const path = require('path');

// Read and evaluate the RequestMetricsLogger
const metricsLoggerPath = path.join(__dirname, 'request-metrics-logger.js');
const metricsLoggerCode = fs.readFileSync(metricsLoggerPath, 'utf8');

// Create a safe evaluation context
const vm = require('vm');
const context = {
    console: mockConsole,
    window: mockWindow,
    document: mockDOM,
    performance: mockWindow.performance,
    Date,
    Math,
    setTimeout: (fn, delay) => setTimeout(fn, delay),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, delay) => setInterval(fn, delay),
    clearInterval: (id) => clearInterval(id),
    RequestMetricsLogger: null,
    module: { exports: {} }
};

vm.createContext(context);
vm.runInContext(metricsLoggerCode, context);

const RequestMetricsLogger = context.RequestMetricsLogger || context.module.exports.RequestMetricsLogger;

// Test Suite for Task 9.1 Integration
class Task91IntegrationTest {
    constructor() {
        this.testResults = [];
        this.logger = RequestMetricsLogger;
    }

    // Test helper methods
    assert(condition, message) {
        if (condition) {
            this.testResults.push({ test: message, status: 'PASS' });
            originalConsole.log(`✓ ${message}`);
        } else {
            this.testResults.push({ test: message, status: 'FAIL' });
            originalConsole.error(`✗ ${message}`);
        }
    }

    assertEquals(actual, expected, message) {
        this.assert(actual === expected, `${message} (expected: ${expected}, actual: ${actual})`);
    }

    assertGreaterThan(actual, expected, message) {
        this.assert(actual > expected, `${message} (expected > ${expected}, actual: ${actual})`);
    }

    // Test 1: RequestMetricsLogger initialization
    testInitialization() {
        originalConsole.log('\n=== Test 1: RequestMetricsLogger Initialization ===');
        
        this.assert(typeof this.logger === 'object', 'RequestMetricsLogger should be an object');
        this.assert(typeof this.logger.initialize === 'function', 'Should have initialize method');
        this.assert(typeof this.logger.startRequest === 'function', 'Should have startRequest method');
        this.assert(typeof this.logger.completeRequest === 'function', 'Should have completeRequest method');
        this.assert(typeof this.logger.failRequest === 'function', 'Should have failRequest method');
        
        // Initialize the logger
        this.logger.initialize();
        
        this.assert(this.logger.metrics.session.startTime > 0, 'Session should have start time');
        this.assertEquals(this.logger.metrics.requests.total, 0, 'Initial request count should be 0');
    }

    // Test 2: Individual request tracking
    testIndividualRequestTracking() {
        originalConsole.log('\n=== Test 2: Individual Request Tracking ===');
        
        const driverName = 'TestDriver1';
        
        // Start a request
        const requestRecord = this.logger.startRequest(driverName, 'individual', false);
        
        this.assert(requestRecord !== null, 'Should return request record');
        this.assertEquals(requestRecord.driverName, driverName, 'Request record should have correct driver name');
        this.assertEquals(requestRecord.requestType, 'individual', 'Request record should have correct type');
        this.assertEquals(requestRecord.isCached, false, 'Request record should have correct cache status');
        this.assertEquals(this.logger.metrics.requests.total, 1, 'Total requests should be 1');
        this.assertEquals(this.logger.metrics.requests.individual, 1, 'Individual requests should be 1');
        
        // Complete the request
        const mockResponseData = { [driverName]: { member_info: { display_name: 'Test Driver' } } };
        this.logger.completeRequest(requestRecord, mockResponseData);
        
        this.assertEquals(this.logger.metrics.requests.successful, 1, 'Successful requests should be 1');
        this.assert(requestRecord.success === true, 'Request record should be marked as successful');
        this.assert(requestRecord.responseTime > 0, 'Request record should have response time');
    }

    // Test 3: Cached request tracking
    testCachedRequestTracking() {
        console.log('\n=== Test 3: Cached Request Tracking ===');
        
        const driverName = 'TestDriver2';
        
        // Start a cached request
        const requestRecord = this.logger.startRequest(driverName, 'individual', true);
        
        this.assertEquals(requestRecord.isCached, true, 'Request should be marked as cached');
        this.assertEquals(this.logger.metrics.requests.cached, 1, 'Cached requests should be 1');
        this.assertEquals(this.logger.metrics.cache.hits, 1, 'Cache hits should be 1');
        
        // Complete the cached request
        const mockCachedData = { [driverName]: { member_info: { display_name: 'Cached Driver' } } };
        this.logger.completeRequest(requestRecord, mockCachedData);
        
        this.assert(this.logger.metrics.cache.hitRate > 0, 'Cache hit rate should be greater than 0');
    }

    // Test 4: Failed request tracking
    testFailedRequestTracking() {
        console.log('\n=== Test 4: Failed Request Tracking ===');
        
        const driverName = 'TestDriver3';
        
        // Start a request
        const requestRecord = this.logger.startRequest(driverName, 'individual', false);
        
        // Simulate a network error
        const mockError = new Error('Network timeout');
        mockError.name = 'TypeError';
        
        this.logger.failRequest(requestRecord, mockError);
        
        this.assertEquals(this.logger.metrics.requests.failed, 1, 'Failed requests should be 1');
        this.assertEquals(requestRecord.success, false, 'Request record should be marked as failed');
        this.assert(this.logger.metrics.errors.network > 0, 'Network errors should be tracked');
        
        // Check driver metrics
        const driverMetric = this.logger.metrics.driverMetrics.get(driverName);
        this.assert(driverMetric !== undefined, 'Driver metrics should exist');
        this.assertEquals(driverMetric.failures, 1, 'Driver should have 1 failure');
    }

    // Test 5: Retry tracking
    testRetryTracking() {
        console.log('\n=== Test 5: Retry Tracking ===');
        
        const driverName = 'TestDriver4';
        
        // Start a request
        const requestRecord = this.logger.startRequest(driverName, 'individual', false);
        
        // Simulate retry attempts
        const mockError = new Error('Temporary failure');
        this.logger.recordRetry(requestRecord, mockError, 1);
        this.logger.recordRetry(requestRecord, mockError, 2);
        
        this.assertEquals(requestRecord.retryCount, 2, 'Request should have 2 retry attempts');
        this.assertEquals(this.logger.metrics.errors.retries, 2, 'Should track 2 retries');
        
        // Check driver metrics
        const driverMetric = this.logger.metrics.driverMetrics.get(driverName);
        this.assertEquals(driverMetric.retries, 2, 'Driver should have 2 retries');
    }

    // Test 6: Performance comparison tracking
    testPerformanceComparison() {
        console.log('\n=== Test 6: Performance Comparison Tracking ===');
        
        // Record a batch request for comparison
        this.logger.recordBatchRequest(5, 2500, true); // 5 drivers, 2.5 seconds
        
        this.assertEquals(this.logger.metrics.timing.batchRequests.count, 1, 'Should have 1 batch request');
        this.assertEquals(this.logger.metrics.timing.batchRequests.averageTime, 2500, 'Batch average time should be 2500ms');
        
        // The performance improvement calculation should work
        if (this.logger.metrics.timing.individualRequests.count > 0) {
            this.assert(
                typeof this.logger.metrics.timing.performanceImprovement === 'number',
                'Performance improvement should be calculated'
            );
        }
    }

    // Test 7: Metrics report generation
    testMetricsReportGeneration() {
        console.log('\n=== Test 7: Metrics Report Generation ===');
        
        const report = this.logger.generateMetricsReport();
        
        this.assert(typeof report === 'object', 'Report should be an object');
        this.assert(typeof report.timestamp === 'string', 'Report should have timestamp');
        this.assert(typeof report.session === 'object', 'Report should have session data');
        this.assert(typeof report.requests === 'object', 'Report should have request data');
        this.assert(typeof report.timing === 'object', 'Report should have timing data');
        this.assert(typeof report.concurrency === 'object', 'Report should have concurrency data');
        this.assert(typeof report.cache === 'object', 'Report should have cache data');
        this.assert(typeof report.errors === 'object', 'Report should have error data');
        
        // Test that the report contains expected data
        this.assertGreaterThan(report.requests.total, 0, 'Report should show total requests');
        this.assertGreaterThan(report.requests.successful, 0, 'Report should show successful requests');
    }

    // Test 8: Concurrent request metrics
    testConcurrentRequestMetrics() {
        console.log('\n=== Test 8: Concurrent Request Metrics ===');
        
        // Simulate concurrent requests
        const driver1Record = this.logger.startRequest('ConcurrentDriver1', 'individual', false);
        const driver2Record = this.logger.startRequest('ConcurrentDriver2', 'individual', false);
        
        this.assertGreaterThan(this.logger.metrics.concurrency.currentConcurrent, 0, 'Should track current concurrent requests');
        this.assertGreaterThan(this.logger.metrics.concurrency.maxConcurrent, 0, 'Should track max concurrent requests');
        
        // Complete the requests
        this.logger.completeRequest(driver1Record, {});
        this.logger.completeRequest(driver2Record, {});
        
        this.assert(this.logger.metrics.concurrency.concurrencyHistory.length > 0, 'Should maintain concurrency history');
    }

    // Test 9: Driver-specific metrics
    testDriverSpecificMetrics() {
        console.log('\n=== Test 9: Driver-Specific Metrics ===');
        
        const driverName = 'MetricsTestDriver';
        
        // Make multiple requests for the same driver
        const request1 = this.logger.startRequest(driverName, 'individual', false);
        this.logger.completeRequest(request1, {});
        
        const request2 = this.logger.startRequest(driverName, 'individual', false);
        this.logger.completeRequest(request2, {});
        
        const driverMetric = this.logger.metrics.driverMetrics.get(driverName);
        
        this.assertEquals(driverMetric.requests, 2, 'Driver should have 2 requests');
        this.assertEquals(driverMetric.successes, 2, 'Driver should have 2 successes');
        this.assert(driverMetric.averageResponseTime > 0, 'Driver should have average response time');
        this.assert(driverMetric.firstRequestTime > 0, 'Driver should have first request time');
        this.assert(driverMetric.lastSuccessTime > 0, 'Driver should have last success time');
    }

    // Test 10: Integration with existing error handling
    testErrorHandlingIntegration() {
        console.log('\n=== Test 10: Error Handling Integration ===');
        
        // Test different error types
        const errorTypes = [
            { error: new Error('fetch failed'), expectedType: 'network' },
            { error: { name: 'AbortError', message: 'timeout' }, expectedType: 'timeout' },
            { error: { status: 500, message: 'Server Error' }, expectedType: 'api' },
            { error: new SyntaxError('Invalid JSON'), expectedType: 'data' }
        ];
        
        errorTypes.forEach((testCase, index) => {
            const driverName = `ErrorTestDriver${index}`;
            const requestRecord = this.logger.startRequest(driverName, 'individual', false);
            this.logger.failRequest(requestRecord, testCase.error);
            
            const categorizedType = this.logger.categorizeError(testCase.error);
            this.assertEquals(categorizedType, testCase.expectedType, 
                `Error should be categorized as ${testCase.expectedType}`);
        });
    }

    // Run all tests
    runAllTests() {
        console.log('🚀 Starting Task 9.1 Integration Tests...\n');
        
        try {
            this.testInitialization();
            this.testIndividualRequestTracking();
            this.testCachedRequestTracking();
            this.testFailedRequestTracking();
            this.testRetryTracking();
            this.testPerformanceComparison();
            this.testMetricsReportGeneration();
            this.testConcurrentRequestMetrics();
            this.testDriverSpecificMetrics();
            this.testErrorHandlingIntegration();
            
            // Generate final report
            console.log('\n=== Final Metrics Report ===');
            this.logger.logMetricsReport();
            
        } catch (error) {
            console.error('Test execution failed:', error);
            this.testResults.push({ test: 'Test Execution', status: 'FAIL', error: error.message });
        }
        
        this.printTestSummary();
    }

    // Print test summary
    printTestSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 TASK 9.1 INTEGRATION TEST SUMMARY');
        console.log('='.repeat(50));
        
        const passed = this.testResults.filter(r => r.status === 'PASS').length;
        const failed = this.testResults.filter(r => r.status === 'FAIL').length;
        const total = this.testResults.length;
        
        console.log(`Total Tests: ${total}`);
        console.log(`Passed: ${passed} ✓`);
        console.log(`Failed: ${failed} ${failed > 0 ? '✗' : ''}`);
        console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
        
        if (failed > 0) {
            console.log('\nFailed Tests:');
            this.testResults
                .filter(r => r.status === 'FAIL')
                .forEach(r => console.log(`  ✗ ${r.test}${r.error ? ` - ${r.error}` : ''}`));
        }
        
        console.log('\n' + '='.repeat(50));
        
        if (failed === 0) {
            console.log('🎉 All tests passed! Task 9.1 integration is working correctly.');
        } else {
            console.log('❌ Some tests failed. Please review the implementation.');
        }
    }
}

// Run the tests
if (require.main === module) {
    const testSuite = new Task91IntegrationTest();
    testSuite.runAllTests();
}

module.exports = Task91IntegrationTest;