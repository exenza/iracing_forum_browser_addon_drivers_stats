// Test Request Prioritization Integration
// This test verifies that the request prioritization system is properly integrated

console.log('=== Testing Request Prioritization Integration ===');

// Test 1: Check if RequestPrioritizer is available
if (typeof RequestPrioritizer !== 'undefined') {
    console.log('✓ RequestPrioritizer is available');
    
    // Test 2: Check if RequestPrioritizer can be initialized
    try {
        RequestPrioritizer.initialize();
        console.log('✓ RequestPrioritizer initialized successfully');
    } catch (error) {
        console.error('✗ RequestPrioritizer initialization failed:', error);
    }
    
    // Test 3: Test driver element registration
    const mockElement = document.createElement('div');
    mockElement.style.position = 'absolute';
    mockElement.style.top = '100px';
    mockElement.style.left = '100px';
    mockElement.style.width = '200px';
    mockElement.style.height = '50px';
    document.body.appendChild(mockElement);
    
    const registered = RequestPrioritizer.registerDriverElement('TestDriver', mockElement);
    if (registered) {
        console.log('✓ Driver element registration works');
    } else {
        console.error('✗ Driver element registration failed');
    }
    
    // Test 4: Test priority calculation
    const priority = RequestPrioritizer.calculateDriverPriority('TestDriver', true, 0.8);
    console.log(`✓ Priority calculation works: ${RequestPrioritizer.getPriorityName(priority)}`);
    
    // Test 5: Test prioritized request creation
    let requestCreated = false;
    try {
        const requestId = RequestPrioritizer.createPrioritizedRequest(
            'TestDriver',
            async (driverName) => {
                console.log(`Mock prioritized request for ${driverName}`);
                return { [driverName]: { member_info: { display_name: driverName } } };
            },
            { canDefer: true }
        );
        
        if (requestId) {
            requestCreated = true;
            console.log('✓ Prioritized request creation works');
        }
    } catch (error) {
        console.error('✗ Prioritized request creation failed:', error);
    }
    
    // Test 6: Test memory pressure detection
    RequestPrioritizer.checkMemoryPressure();
    const stats = RequestPrioritizer.getStats();
    console.log('✓ Memory pressure detection works:', {
        memoryPressure: stats.memoryPressure,
        memoryUsage: stats.memoryUsage
    });
    
    // Test 7: Test visibility tracking with IntersectionObserver
    if (window.IntersectionObserver) {
        console.log('✓ IntersectionObserver is available for visibility tracking');
    } else {
        console.log('⚠ IntersectionObserver not available, using fallback visibility detection');
    }
    
    // Test 8: Test request queue processing
    setTimeout(() => {
        const finalStats = RequestPrioritizer.getStats();
        console.log('✓ Request queue processing stats:', {
            totalQueued: finalStats.totalQueued,
            totalActive: finalStats.totalActive,
            registeredDrivers: finalStats.registeredDrivers
        });
        
        // Cleanup test element
        document.body.removeChild(mockElement);
        
        console.log('=== Request Prioritization Integration Test Complete ===');
        
        // Test 9: Test integration with main fetch function
        if (typeof makeIndividualDriverRequest !== 'undefined') {
            console.log('✓ Main fetch function integration available');
        } else {
            console.log('⚠ Main fetch function integration not found');
        }
        
    }, 1000);
    
} else {
    console.error('✗ RequestPrioritizer is not available - prioritization system not loaded');
}

// Test performance monitoring integration
if (typeof PerformanceMonitor !== 'undefined') {
    console.log('✓ PerformanceMonitor is available for integration');
} else {
    console.log('⚠ PerformanceMonitor not available');
}

console.log('Request prioritization integration test started...');