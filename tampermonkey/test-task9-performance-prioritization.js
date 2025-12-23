// Test file for Task 9: Performance Optimization and Monitoring
// Tests the integration of PerformanceMonitor and RequestPrioritizer

// Mock DOM environment for testing
const mockDOM = {
    createElement: (tag) => ({
        setAttribute: () => {},
        getAttribute: () => null,
        classList: { add: () => {}, remove: () => {} },
        style: {},
        innerHTML: '',
        querySelector: () => null,
        addEventListener: () => {}
    }),
    querySelector: () => null,
    contains: () => true,
    readyState: 'complete',
    addEventListener: () => {},
    hidden: false,
    hasFocus: () => true
};

const mockWindow = {
    IntersectionObserver: class {
        constructor(callback, options) {
            this.callback = callback;
            this.options = options;
        }
        observe() {}
        disconnect() {}
    },
    performance: {
        now: () => Date.now(),
        memory: {
            usedJSHeapSize: 50 * 1024 * 1024 // 50MB
        }
    },
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => {},
    gc: () => {},
    sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        key: () => null,
        length: 0
    }
};

const mockHistory = {
    pushState: () => {},
    replaceState: () => {}
};

// Set up global mocks
global.document = mockDOM;
global.window = mockWindow;
global.performance = mockWindow.performance;
global.history = mockHistory;
global.navigator = { userAgent: 'Test Browser' };
global.CONFIG = { API_ENDPOINT: 'https://test-api.example.com' };

// Load the performance optimization modules in correct dependency order
require('./concurrent.js');  // Load base components first
require('./performance-monitor.js');
require('./request-prioritization.js');
require('./performance-integration.js');
require('./performance-prioritization-integration.js');

// Test Performance Monitor
console.log('=== Testing Performance Monitor ===');

// Test initialization
PerformanceMonitor.initialize();
console.log('✓ PerformanceMonitor initialized');

// Test request tracking
const requestInfo = PerformanceMonitor.startRequest('TestDriver', 'individual');
console.log('✓ Started request tracking:', requestInfo.requestId);

// Simulate request completion
setTimeout(() => {
    PerformanceMonitor.completeRequest(requestInfo, { TestDriver: { member_info: { display_name: 'Test Driver' } } });
    console.log('✓ Completed request tracking');
    
    // Test performance report generation
    const report = PerformanceMonitor.generatePerformanceReport();
    console.log('✓ Generated performance report:', {
        totalRequests: report.timing.totalRequests,
        successRate: report.summary.successRate,
        averageResponseTime: report.summary.averageResponseTime
    });
}, 100);

// Test Request Prioritizer
console.log('\n=== Testing Request Prioritizer ===');

// Test initialization
RequestPrioritizer.initialize();
console.log('✓ RequestPrioritizer initialized');

// Test driver element registration
const mockElement = mockDOM.createElement('div');
const registered = RequestPrioritizer.registerDriverElement('TestDriver', mockElement);
console.log('✓ Driver element registered:', registered);

// Test priority calculation
const priority = RequestPrioritizer.calculateDriverPriority('TestDriver', true, 0.8);
console.log('✓ Priority calculated:', RequestPrioritizer.getPriorityName(priority));

// Test prioritized request creation
const requestId = RequestPrioritizer.createPrioritizedRequest(
    'TestDriver',
    async (driverName) => {
        console.log(`Mock request for ${driverName}`);
        return { [driverName]: { member_info: { display_name: driverName } } };
    },
    { canDefer: true }
);
console.log('✓ Prioritized request created:', requestId);

// Test statistics
setTimeout(() => {
    const stats = RequestPrioritizer.getStats();
    console.log('✓ Prioritizer stats:', {
        totalQueued: stats.totalQueued,
        totalActive: stats.totalActive,
        registeredDrivers: stats.registeredDrivers,
        memoryPressure: stats.memoryPressure
    });
}, 200);

// Test Performance Integration
console.log('\n=== Testing Performance Integration ===');

// Test performance-aware individual request handler
setTimeout(async () => {
    try {
        // Mock fetch for testing
        global.fetch = async (url) => {
            console.log('Mock fetch called for:', url);
            return {
                ok: true,
                json: async () => ({
                    TestDriver: {
                        member_info: {
                            display_name: 'Test Driver',
                            irating: 1500,
                            member_since: '2020-01-01'
                        }
                    }
                })
            };
        };
        
        const result = await PerformanceAwareIndividualRequestHandler.fetchSingleDriver('TestDriver');
        console.log('✓ Performance-aware request completed:', Object.keys(result));
        
        // Test performance-prioritized integration
        if (typeof fetchDriverDataWithPerformanceAndPrioritization !== 'undefined') {
            const integratedResult = await fetchDriverDataWithPerformanceAndPrioritization(['TestDriver']);
            console.log('✓ Performance-prioritized integration completed:', Object.keys(integratedResult));
        }
        
    } catch (error) {
        console.error('✗ Performance integration test failed:', error.message);
    }
}, 300);

// Test memory pressure simulation
console.log('\n=== Testing Memory Pressure Handling ===');

setTimeout(() => {
    // Simulate high memory usage
    if (mockWindow.performance.memory) {
        mockWindow.performance.memory.usedJSHeapSize = 100 * 1024 * 1024; // 100MB
    }
    
    RequestPrioritizer.checkMemoryPressure();
    
    const statsAfterPressure = RequestPrioritizer.getStats();
    console.log('✓ Memory pressure test:', {
        memoryPressure: statsAfterPressure.memoryPressure,
        memoryUsage: statsAfterPressure.memoryUsage
    });
}, 400);

// Test cleanup
setTimeout(() => {
    console.log('\n=== Testing Cleanup ===');
    
    PerformanceMonitor.cleanup();
    console.log('✓ PerformanceMonitor cleanup completed');
    
    RequestPrioritizer.cleanup();
    console.log('✓ RequestPrioritizer cleanup completed');
    
    console.log('\n=== All Tests Completed ===');
    
    // Final performance report
    console.log('\n=== Final Performance Report ===');
    PerformanceMonitor.logPerformanceReport();
    
}, 500);

// Test error scenarios
console.log('\n=== Testing Error Scenarios ===');

setTimeout(() => {
    // Test failed request tracking
    const failedRequestInfo = PerformanceMonitor.startRequest('FailedDriver', 'individual');
    const mockError = new Error('Network timeout');
    mockError.name = 'AbortError';
    
    PerformanceMonitor.failRequest(failedRequestInfo, mockError);
    console.log('✓ Failed request tracking completed');
    
    // Test retry recording
    PerformanceMonitor.recordRetry('FailedDriver', 2, mockError);
    console.log('✓ Retry recording completed');
    
}, 600);

console.log('Performance optimization and monitoring tests started...');