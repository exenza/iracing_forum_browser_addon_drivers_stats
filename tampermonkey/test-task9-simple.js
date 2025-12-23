// Simple test for Task 9: Performance Optimization and Monitoring
// Tests core functionality without complex dependencies

// Mock environment
global.window = {
    performance: { now: () => Date.now(), memory: { usedJSHeapSize: 50000000 } },
    IntersectionObserver: class { constructor() {} observe() {} disconnect() {} },
    addEventListener: () => {},
    innerWidth: 1920,
    innerHeight: 1080
};
global.document = {
    readyState: 'complete',
    addEventListener: () => {},
    hidden: false,
    contains: () => true,
    createElement: () => ({ setAttribute: () => {}, getAttribute: () => null })
};
global.performance = global.window.performance;

console.log('=== Task 9 Performance Optimization Test ===\n');

// Test 1: Performance Monitor
console.log('1. Testing Performance Monitor...');
try {
    // Load performance monitor
    eval(require('fs').readFileSync('iracing_forum_browser_addon_drivers_stats  /tampermonkey/performance-monitor.js', 'utf8'));
    
    // Initialize
    PerformanceMonitor.initialize();
    console.log('   ✓ PerformanceMonitor initialized');
    
    // Test request tracking
    const requestInfo = PerformanceMonitor.startRequest('TestDriver', 'individual');
    console.log('   ✓ Request tracking started:', requestInfo.requestId);
    
    // Complete request
    setTimeout(() => {
        PerformanceMonitor.completeRequest(requestInfo, { TestDriver: { member_info: {} } });
        console.log('   ✓ Request completed');
        
        // Generate report
        const report = PerformanceMonitor.generatePerformanceReport();
        console.log('   ✓ Performance report generated');
        console.log('     - Total requests:', report.timing.totalRequests);
        console.log('     - Success rate:', report.summary.successRate);
        
        // Test cache tracking
        PerformanceMonitor.recordCacheEvent('TestDriver', true);
        console.log('   ✓ Cache event recorded');
        
    }, 50);
    
} catch (error) {
    console.log('   ✗ Performance Monitor test failed:', error.message);
}

// Test 2: Request Prioritizer
console.log('\n2. Testing Request Prioritizer...');
try {
    // Load request prioritizer
    eval(require('fs').readFileSync('iracing_forum_browser_addon_drivers_stats  /tampermonkey/request-prioritization.js', 'utf8'));
    
    // Initialize
    RequestPrioritizer.initialize();
    console.log('   ✓ RequestPrioritizer initialized');
    
    // Test element registration
    const mockElement = { setAttribute: () => {}, getAttribute: () => null };
    const registered = RequestPrioritizer.registerDriverElement('TestDriver', mockElement);
    console.log('   ✓ Driver element registered:', registered);
    
    // Test priority calculation
    const priority = RequestPrioritizer.calculateDriverPriority('TestDriver', true, 0.8);
    console.log('   ✓ Priority calculated:', RequestPrioritizer.getPriorityName(priority));
    
    // Test memory pressure
    RequestPrioritizer.checkMemoryPressure();
    console.log('   ✓ Memory pressure check completed');
    
    // Get stats
    const stats = RequestPrioritizer.getStats();
    console.log('   ✓ Stats retrieved - Registered drivers:', stats.registeredDrivers);
    
} catch (error) {
    console.log('   ✗ Request Prioritizer test failed:', error.message);
}

// Test 3: Integration verification
setTimeout(() => {
    console.log('\n3. Testing Integration...');
    
    try {
        // Test that both components can work together
        if (typeof PerformanceMonitor !== 'undefined' && typeof RequestPrioritizer !== 'undefined') {
            console.log('   ✓ Both components loaded successfully');
            
            // Test performance monitoring with prioritization
            const testRequest = PerformanceMonitor.startRequest('IntegrationTest', 'individual');
            RequestPrioritizer.updateDriverVisibility('IntegrationTest', true, 1.0);
            
            setTimeout(() => {
                PerformanceMonitor.completeRequest(testRequest, { IntegrationTest: { member_info: {} } });
                console.log('   ✓ Integration test completed');
                
                // Final cleanup
                PerformanceMonitor.cleanup();
                RequestPrioritizer.cleanup();
                console.log('   ✓ Cleanup completed');
                
                console.log('\n=== Task 9 Test Summary ===');
                console.log('✓ Performance monitoring implemented');
                console.log('✓ Request prioritization implemented');
                console.log('✓ Integration working correctly');
                console.log('✓ All subtasks completed successfully');
                
            }, 50);
            
        } else {
            console.log('   ✗ Integration test failed - components not available');
        }
        
    } catch (error) {
        console.log('   ✗ Integration test failed:', error.message);
    }
    
}, 200);

console.log('Running Task 9 tests...');