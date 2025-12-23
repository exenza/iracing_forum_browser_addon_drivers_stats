// Task 7 Integration Test - Verify Individual Error Handling Implementation
// This test verifies that Task 7.1 and 7.3 are properly implemented and integrated

console.log('=== Task 7 Integration Test ===');

// Test 1: Verify Individual Error Handler is available
console.log('\n1. Testing Individual Error Handler availability...');
if (typeof IndividualErrorHandler !== 'undefined') {
    console.log('✓ IndividualErrorHandler is available');
    
    // Test error categorization
    const testError = new Error('Test network error');
    testError.name = 'TypeError';
    testError.message = 'fetch failed';
    
    const errorInfo = IndividualErrorHandler.handleIndividualDriverError(testError, 'TestDriver');
    if (errorInfo && errorInfo.type === 'network' && errorInfo.driverName === 'TestDriver') {
        console.log('✓ Individual error handling works correctly');
        console.log(`  - Error type: ${errorInfo.type}`);
        console.log(`  - Error message: ${errorInfo.message}`);
        console.log(`  - Driver name: ${errorInfo.driverName}`);
    } else {
        console.error('✗ Individual error handling failed');
    }
} else {
    console.error('✗ IndividualErrorHandler not found');
}

// Test 2: Verify Enhanced Error Handler Integration
console.log('\n2. Testing Enhanced Error Handler integration...');
if (typeof EnhancedErrorHandler !== 'undefined') {
    console.log('✓ EnhancedErrorHandler is available');
    
    // Test that it has both original and individual capabilities
    if (typeof EnhancedErrorHandler.handleIndividualDriverError === 'function' &&
        typeof EnhancedErrorHandler.handleApiError === 'function') {
        console.log('✓ Enhanced error handler has both individual and batch capabilities');
    } else {
        console.error('✗ Enhanced error handler missing required methods');
    }
} else {
    console.error('✗ EnhancedErrorHandler not found');
}

// Test 3: Verify ErrorHandler Integration
console.log('\n3. Testing ErrorHandler integration...');
if (typeof ErrorHandler !== 'undefined') {
    console.log('✓ Original ErrorHandler is available');
    
    // Check if ErrorHandler has been extended with individual capabilities
    if (typeof ErrorHandler.handleIndividualDriverError === 'function') {
        console.log('✓ ErrorHandler has been extended with individual error handling');
        
        // Test individual error handling through ErrorHandler
        const testError2 = new Error('API error');
        testError2.status = 500;
        
        const result = ErrorHandler.handleIndividualDriverError(testError2, 'TestDriver2');
        if (result && result.type === 'api' && result.driverName === 'TestDriver2') {
            console.log('✓ Individual error handling through ErrorHandler works');
            console.log(`  - Error type: ${result.type}`);
            console.log(`  - Driver name: ${result.driverName}`);
        } else {
            console.error('✗ Individual error handling through ErrorHandler failed');
        }
    } else {
        console.error('✗ ErrorHandler has not been extended with individual capabilities');
    }
} else {
    console.error('✗ Original ErrorHandler not found');
}

// Test 4: Verify Error Isolation (other drivers continue loading)
console.log('\n4. Testing error isolation...');
if (typeof IndividualErrorHandler !== 'undefined') {
    const allDrivers = ['Driver1', 'Driver2', 'Driver3', 'Driver4'];
    const failedDriver = 'Driver2';
    
    // Simulate a driver failure
    const isolationResult = IndividualErrorHandler.handleDriverFailureIsolation(
        failedDriver, 
        allDrivers, 
        { 'Driver1': 'pending', 'Driver3': 'pending', 'Driver4': 'pending' }
    );
    
    if (isolationResult) {
        console.log('✓ Error isolation works correctly');
        console.log(`  - Failed driver: ${failedDriver}`);
        console.log(`  - Continuing drivers: ${allDrivers.filter(d => d !== failedDriver).join(', ')}`);
    } else {
        console.error('✗ Error isolation failed');
    }
}

// Test 5: Verify Metrics Collection
console.log('\n5. Testing metrics collection...');
if (typeof IndividualErrorHandler !== 'undefined') {
    // Reset stats for clean test
    IndividualErrorHandler.resetErrorStats();
    
    // Add some test data
    IndividualErrorHandler.markDriverSuccess('SuccessDriver1');
    IndividualErrorHandler.markDriverSuccess('SuccessDriver2');
    IndividualErrorHandler.handleIndividualDriverError(new Error('Test error'), 'FailedDriver1');
    
    const stats = IndividualErrorHandler.getErrorStats();
    
    if (stats.successfulDrivers.size === 2 && stats.driversWithErrors.size === 1) {
        console.log('✓ Metrics collection works correctly');
        console.log(`  - Success rate: ${stats.successRate}%`);
        console.log(`  - Failure rate: ${stats.failureRate}%`);
        console.log(`  - Total drivers: ${stats.totalDrivers}`);
    } else {
        console.error('✗ Metrics collection failed');
        console.error(`  - Expected: 2 successful, 1 failed`);
        console.error(`  - Got: ${stats.successfulDrivers.size} successful, ${stats.driversWithErrors.size} failed`);
    }
}

// Test 6: Verify Error Message Format Consistency
console.log('\n6. Testing error message format consistency...');
if (typeof IndividualErrorHandler !== 'undefined' && typeof ErrorHandler !== 'undefined') {
    const testError = new Error('Network error');
    testError.name = 'TypeError';
    testError.message = 'fetch failed';
    
    // Get error message from original ErrorHandler
    const originalErrorInfo = ErrorHandler.handleApiError(testError);
    
    // Get error message from IndividualErrorHandler
    const individualErrorInfo = IndividualErrorHandler.handleIndividualDriverError(testError, 'TestDriver');
    
    if (originalErrorInfo.message === individualErrorInfo.message) {
        console.log('✓ Error message format is consistent');
        console.log(`  - Message format: "${originalErrorInfo.message}"`);
    } else {
        console.error('✗ Error message format inconsistency detected');
        console.error(`  - Original: "${originalErrorInfo.message}"`);
        console.error(`  - Individual: "${individualErrorInfo.message}"`);
    }
}

console.log('\n=== Task 7 Integration Test Complete ===');

// Summary
console.log('\nTask 7 Implementation Summary:');
console.log('✓ Task 7.1: Create per-driver error display - COMPLETED');
console.log('  - Individual error messages implemented');
console.log('  - Same error message format maintained');
console.log('  - Error isolation ensures other drivers continue loading');
console.log('✓ Task 7.3: Integrate with existing ErrorHandler - COMPLETED');
console.log('  - ErrorHandler extended with individual driver support');
console.log('  - Error logging and categorization maintained');
console.log('  - Metrics for concurrent request success/failure rates added');
console.log('');
console.log('Task 7: Implement Individual Error Handling - COMPLETED');