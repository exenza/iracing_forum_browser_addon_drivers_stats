// Performance Monitor for iRacing Forum Browser Extension
// Tracks concurrent request performance, timing, and success/failure rates

const PerformanceMonitor = {
    // Performance metrics storage
    metrics: {
        // Request timing metrics
        requestTiming: {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            totalResponseTime: 0,
            responseTimes: [], // Keep last 100 response times for detailed analysis
            timeouts: 0,
            retries: 0
        },
        
        // Concurrent execution metrics
        concurrency: {
            maxConcurrentRequests: 0,
            currentConcurrentRequests: 0,
            concurrentPeakCount: 0,
            queuedRequests: 0,
            averageConcurrency: 0,
            concurrencyHistory: [] // Track concurrency over time
        },
        
        // Per-driver success/failure rates
        driverMetrics: new Map(),
        
        // Error breakdown
        errorBreakdown: {
            network: 0,
            timeout: 0,
            api: 0,
            data: 0,
            unknown: 0
        },
        
        // Performance comparison (individual vs batch)
        comparison: {
            individualRequests: {
                totalTime: 0,
                requestCount: 0,
                averageTime: 0
            },
            batchRequests: {
                totalTime: 0,
                requestCount: 0,
                averageTime: 0
            },
            performanceImprovement: 0 // Percentage improvement
        },
        
        // Session metrics
        session: {
            startTime: Date.now(),
            totalDriversProcessed: 0,
            uniqueDriversProcessed: new Set(),
            pagesProcessed: 0,
            cacheHitRate: 0,
            cacheHits: 0,
            cacheMisses: 0
        }
    },
    
    // Configuration
    config: {
        maxResponseTimeHistory: 100,
        maxConcurrencyHistory: 50,
        logLevel: 'info', // 'debug', 'info', 'warn', 'error'
        enableDetailedLogging: true,
        performanceReportInterval: 30000 // 30 seconds
    },
    
    // Initialize performance monitoring
    initialize() {
        console.log('PerformanceMonitor: Initializing performance monitoring system');
        
        // Reset metrics
        this.resetMetrics();
        
        // Start periodic performance reporting
        if (this.config.performanceReportInterval > 0) {
            this.startPeriodicReporting();
        }
        
        // Register cleanup handlers
        this.registerCleanupHandlers();
        
        console.log('PerformanceMonitor: Performance monitoring initialized');
    },
    
    // Start a request timing measurement
    startRequest(driverName, requestType = 'individual') {
        const requestId = this.generateRequestId(driverName);
        const startTime = performance.now();
        
        // Track request start
        this.metrics.requestTiming.totalRequests++;
        this.metrics.concurrency.currentConcurrentRequests++;
        
        // Update peak concurrency
        if (this.metrics.concurrency.currentConcurrentRequests > this.metrics.concurrency.concurrentPeakCount) {
            this.metrics.concurrency.concurrentPeakCount = this.metrics.concurrency.currentConcurrentRequests;
        }
        
        // Track concurrency history
        this.trackConcurrencyHistory();
        
        // Initialize driver metrics if not exists
        if (!this.metrics.driverMetrics.has(driverName)) {
            this.metrics.driverMetrics.set(driverName, {
                requests: 0,
                successes: 0,
                failures: 0,
                averageResponseTime: 0,
                totalResponseTime: 0,
                errors: []
            });
        }
        
        const driverMetric = this.metrics.driverMetrics.get(driverName);
        driverMetric.requests++;
        
        this.log('debug', `Started request for driver: ${driverName} (ID: ${requestId})`);
        
        return {
            requestId,
            driverName,
            startTime,
            requestType
        };
    },
    
    // Complete a successful request
    completeRequest(requestInfo, responseData = null) {
        const endTime = performance.now();
        const responseTime = endTime - requestInfo.startTime;
        
        // Update timing metrics
        this.metrics.requestTiming.completedRequests++;
        this.metrics.concurrency.currentConcurrentRequests--;
        this.metrics.requestTiming.totalResponseTime += responseTime;
        this.metrics.requestTiming.averageResponseTime = 
            this.metrics.requestTiming.totalResponseTime / this.metrics.requestTiming.completedRequests;
        
        // Update min/max response times
        this.metrics.requestTiming.minResponseTime = Math.min(this.metrics.requestTiming.minResponseTime, responseTime);
        this.metrics.requestTiming.maxResponseTime = Math.max(this.metrics.requestTiming.maxResponseTime, responseTime);
        
        // Track response time history
        this.metrics.requestTiming.responseTimes.push(responseTime);
        if (this.metrics.requestTiming.responseTimes.length > this.config.maxResponseTimeHistory) {
            this.metrics.requestTiming.responseTimes.shift();
        }
        
        // Update driver-specific metrics
        const driverMetric = this.metrics.driverMetrics.get(requestInfo.driverName);
        if (driverMetric) {
            driverMetric.successes++;
            driverMetric.totalResponseTime += responseTime;
            driverMetric.averageResponseTime = driverMetric.totalResponseTime / driverMetric.successes;
        }
        
        // Update comparison metrics
        if (requestInfo.requestType === 'individual') {
            this.metrics.comparison.individualRequests.totalTime += responseTime;
            this.metrics.comparison.individualRequests.requestCount++;
            this.metrics.comparison.individualRequests.averageTime = 
                this.metrics.comparison.individualRequests.totalTime / 
                this.metrics.comparison.individualRequests.requestCount;
        }
        
        // Update session metrics
        this.metrics.session.totalDriversProcessed++;
        this.metrics.session.uniqueDriversProcessed.add(requestInfo.driverName);
        
        this.log('info', `Completed request for driver: ${requestInfo.driverName} in ${responseTime.toFixed(2)}ms`);
        
        // Log detailed performance data if enabled
        if (this.config.enableDetailedLogging) {
            this.logDetailedPerformance(requestInfo, responseTime, responseData);
        }
    },
    
    // Record a failed request
    failRequest(requestInfo, error) {
        const endTime = performance.now();
        const responseTime = endTime - requestInfo.startTime;
        
        // Update failure metrics
        this.metrics.requestTiming.failedRequests++;
        this.metrics.concurrency.currentConcurrentRequests--;
        
        // Categorize error
        const errorType = this.categorizeError(error);
        this.metrics.errorBreakdown[errorType]++;
        
        // Update driver-specific metrics
        const driverMetric = this.metrics.driverMetrics.get(requestInfo.driverName);
        if (driverMetric) {
            driverMetric.failures++;
            driverMetric.errors.push({
                type: errorType,
                message: error.message || 'Unknown error',
                timestamp: Date.now(),
                responseTime: responseTime
            });
            
            // Keep only last 10 errors per driver
            if (driverMetric.errors.length > 10) {
                driverMetric.errors.shift();
            }
        }
        
        // Track timeout specifically
        if (errorType === 'timeout') {
            this.metrics.requestTiming.timeouts++;
        }
        
        this.log('warn', `Failed request for driver: ${requestInfo.driverName} after ${responseTime.toFixed(2)}ms - ${errorType}: ${error.message}`);
    },
    
    // Record a retry attempt
    recordRetry(driverName, attempt, error) {
        this.metrics.requestTiming.retries++;
        
        const driverMetric = this.metrics.driverMetrics.get(driverName);
        if (driverMetric) {
            driverMetric.errors.push({
                type: 'retry',
                message: `Retry attempt ${attempt}: ${error.message}`,
                timestamp: Date.now(),
                attempt: attempt
            });
        }
        
        this.log('warn', `Retry attempt ${attempt} for driver: ${driverName} - ${error.message}`);
    },
    
    // Record cache hit/miss
    recordCacheEvent(driverName, isHit) {
        if (isHit) {
            this.metrics.session.cacheHits++;
        } else {
            this.metrics.session.cacheMisses++;
        }
        
        // Update cache hit rate
        const totalCacheEvents = this.metrics.session.cacheHits + this.metrics.session.cacheMisses;
        this.metrics.session.cacheHitRate = (this.metrics.session.cacheHits / totalCacheEvents) * 100;
        
        this.log('debug', `Cache ${isHit ? 'hit' : 'miss'} for driver: ${driverName} (Hit rate: ${this.metrics.session.cacheHitRate.toFixed(1)}%)`);
    },
    
    // Record batch request for comparison
    recordBatchRequest(driverCount, totalTime) {
        this.metrics.comparison.batchRequests.totalTime += totalTime;
        this.metrics.comparison.batchRequests.requestCount += driverCount;
        this.metrics.comparison.batchRequests.averageTime = 
            this.metrics.comparison.batchRequests.totalTime / 
            this.metrics.comparison.batchRequests.requestCount;
        
        // Calculate performance improvement
        if (this.metrics.comparison.batchRequests.averageTime > 0 && 
            this.metrics.comparison.individualRequests.averageTime > 0) {
            
            const improvement = ((this.metrics.comparison.batchRequests.averageTime - 
                                this.metrics.comparison.individualRequests.averageTime) / 
                                this.metrics.comparison.batchRequests.averageTime) * 100;
            
            this.metrics.comparison.performanceImprovement = improvement;
        }
        
        this.log('info', `Recorded batch request: ${driverCount} drivers in ${totalTime.toFixed(2)}ms`);
    },
    
    // Track concurrency over time
    trackConcurrencyHistory() {
        const now = Date.now();
        this.metrics.concurrency.concurrencyHistory.push({
            timestamp: now,
            concurrent: this.metrics.concurrency.currentConcurrentRequests
        });
        
        // Keep only recent history
        if (this.metrics.concurrency.concurrencyHistory.length > this.config.maxConcurrencyHistory) {
            this.metrics.concurrency.concurrencyHistory.shift();
        }
        
        // Update average concurrency
        const totalConcurrency = this.metrics.concurrency.concurrencyHistory.reduce(
            (sum, entry) => sum + entry.concurrent, 0
        );
        this.metrics.concurrency.averageConcurrency = 
            totalConcurrency / this.metrics.concurrency.concurrencyHistory.length;
    },
    
    // Generate comprehensive performance report
    generatePerformanceReport() {
        const sessionDuration = Date.now() - this.metrics.session.startTime;
        const sessionDurationMinutes = sessionDuration / (1000 * 60);
        
        const report = {
            summary: {
                sessionDuration: sessionDurationMinutes.toFixed(2) + ' minutes',
                totalRequests: this.metrics.requestTiming.totalRequests,
                successRate: this.getSuccessRate(),
                averageResponseTime: this.metrics.requestTiming.averageResponseTime.toFixed(2) + 'ms',
                peakConcurrency: this.metrics.concurrency.concurrentPeakCount,
                cacheHitRate: this.metrics.session.cacheHitRate.toFixed(1) + '%'
            },
            
            timing: {
                averageResponseTime: this.metrics.requestTiming.averageResponseTime.toFixed(2) + 'ms',
                minResponseTime: this.metrics.requestTiming.minResponseTime === Infinity ? 
                    'N/A' : this.metrics.requestTiming.minResponseTime.toFixed(2) + 'ms',
                maxResponseTime: this.metrics.requestTiming.maxResponseTime.toFixed(2) + 'ms',
                totalRequests: this.metrics.requestTiming.totalRequests,
                completedRequests: this.metrics.requestTiming.completedRequests,
                failedRequests: this.metrics.requestTiming.failedRequests,
                timeouts: this.metrics.requestTiming.timeouts,
                retries: this.metrics.requestTiming.retries
            },
            
            concurrency: {
                peakConcurrency: this.metrics.concurrency.concurrentPeakCount,
                averageConcurrency: this.metrics.concurrency.averageConcurrency.toFixed(2),
                currentConcurrency: this.metrics.concurrency.currentConcurrentRequests
            },
            
            errors: {
                ...this.metrics.errorBreakdown,
                total: Object.values(this.metrics.errorBreakdown).reduce((sum, count) => sum + count, 0)
            },
            
            performance: {
                individualVsBatch: this.metrics.comparison.performanceImprovement.toFixed(1) + '% improvement',
                individualAverage: this.metrics.comparison.individualRequests.averageTime.toFixed(2) + 'ms',
                batchAverage: this.metrics.comparison.batchRequests.averageTime.toFixed(2) + 'ms'
            },
            
            session: {
                totalDriversProcessed: this.metrics.session.totalDriversProcessed,
                uniqueDriversProcessed: this.metrics.session.uniqueDriversProcessed.size,
                cacheHits: this.metrics.session.cacheHits,
                cacheMisses: this.metrics.session.cacheMisses,
                cacheHitRate: this.metrics.session.cacheHitRate.toFixed(1) + '%'
            },
            
            topDrivers: this.getTopDriversByRequests(5),
            slowestDrivers: this.getSlowestDrivers(5),
            mostFailedDrivers: this.getMostFailedDrivers(5)
        };
        
        return report;
    },
    
    // Get success rate percentage
    getSuccessRate() {
        const total = this.metrics.requestTiming.totalRequests;
        if (total === 0) return 0;
        
        const successRate = (this.metrics.requestTiming.completedRequests / total) * 100;
        return successRate.toFixed(1) + '%';
    },
    
    // Get top drivers by request count
    getTopDriversByRequests(limit = 5) {
        return Array.from(this.metrics.driverMetrics.entries())
            .sort((a, b) => b[1].requests - a[1].requests)
            .slice(0, limit)
            .map(([driverName, metrics]) => ({
                driver: driverName,
                requests: metrics.requests,
                successRate: ((metrics.successes / metrics.requests) * 100).toFixed(1) + '%',
                averageTime: metrics.averageResponseTime.toFixed(2) + 'ms'
            }));
    },
    
    // Get slowest drivers by average response time
    getSlowestDrivers(limit = 5) {
        return Array.from(this.metrics.driverMetrics.entries())
            .filter(([_, metrics]) => metrics.successes > 0)
            .sort((a, b) => b[1].averageResponseTime - a[1].averageResponseTime)
            .slice(0, limit)
            .map(([driverName, metrics]) => ({
                driver: driverName,
                averageTime: metrics.averageResponseTime.toFixed(2) + 'ms',
                requests: metrics.requests,
                successRate: ((metrics.successes / metrics.requests) * 100).toFixed(1) + '%'
            }));
    },
    
    // Get drivers with most failures
    getMostFailedDrivers(limit = 5) {
        return Array.from(this.metrics.driverMetrics.entries())
            .filter(([_, metrics]) => metrics.failures > 0)
            .sort((a, b) => b[1].failures - a[1].failures)
            .slice(0, limit)
            .map(([driverName, metrics]) => ({
                driver: driverName,
                failures: metrics.failures,
                requests: metrics.requests,
                failureRate: ((metrics.failures / metrics.requests) * 100).toFixed(1) + '%'
            }));
    },
    
    // Log performance report to console
    logPerformanceReport() {
        const report = this.generatePerformanceReport();
        
        console.log('=== iRacing Forum Extension Performance Report ===');
        console.log('Summary:', report.summary);
        console.log('Timing:', report.timing);
        console.log('Concurrency:', report.concurrency);
        console.log('Errors:', report.errors);
        console.log('Performance:', report.performance);
        console.log('Session:', report.session);
        
        if (report.topDrivers.length > 0) {
            console.log('Top Drivers by Requests:', report.topDrivers);
        }
        
        if (report.slowestDrivers.length > 0) {
            console.log('Slowest Drivers:', report.slowestDrivers);
        }
        
        if (report.mostFailedDrivers.length > 0) {
            console.log('Most Failed Drivers:', report.mostFailedDrivers);
        }
        
        console.log('=== End Performance Report ===');
    },
    
    // Start periodic performance reporting
    startPeriodicReporting() {
        this.reportingInterval = setInterval(() => {
            if (this.metrics.requestTiming.totalRequests > 0) {
                this.logPerformanceReport();
            }
        }, this.config.performanceReportInterval);
        
        console.log(`PerformanceMonitor: Started periodic reporting every ${this.config.performanceReportInterval / 1000} seconds`);
    },
    
    // Stop periodic reporting
    stopPeriodicReporting() {
        if (this.reportingInterval) {
            clearInterval(this.reportingInterval);
            this.reportingInterval = null;
            console.log('PerformanceMonitor: Stopped periodic reporting');
        }
    },
    
    // Log detailed performance data
    logDetailedPerformance(requestInfo, responseTime, responseData) {
        const details = {
            driver: requestInfo.driverName,
            requestId: requestInfo.requestId,
            responseTime: responseTime.toFixed(2) + 'ms',
            requestType: requestInfo.requestType,
            timestamp: new Date().toISOString(),
            concurrentRequests: this.metrics.concurrency.currentConcurrentRequests,
            dataSize: responseData ? JSON.stringify(responseData).length : 0
        };
        
        this.log('debug', 'Detailed performance data:', details);
    },
    
    // Categorize errors for metrics
    categorizeError(error) {
        if (!error) return 'unknown';
        
        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return 'network';
        }
        
        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return 'timeout';
        }
        
        if (error.status && (error.status >= 400 && error.status < 600)) {
            return 'api';
        }
        
        if (error instanceof SyntaxError || (error.message && error.message.includes('JSON'))) {
            return 'data';
        }
        
        return 'unknown';
    },
    
    // Generate unique request ID
    generateRequestId(driverName) {
        return `${driverName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },
    
    // Logging with levels
    log(level, message, data = null) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const configLevel = levels[this.config.logLevel] || 1;
        
        if (levels[level] >= configLevel) {
            const timestamp = new Date().toISOString();
            const prefix = `[${timestamp}] PerformanceMonitor [${level.toUpperCase()}]:`;
            
            if (data) {
                console[level](prefix, message, data);
            } else {
                console[level](prefix, message);
            }
        }
    },
    
    // Reset all metrics
    resetMetrics() {
        this.metrics.requestTiming = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            totalResponseTime: 0,
            responseTimes: [],
            timeouts: 0,
            retries: 0
        };
        
        this.metrics.concurrency = {
            maxConcurrentRequests: 0,
            currentConcurrentRequests: 0,
            concurrentPeakCount: 0,
            queuedRequests: 0,
            averageConcurrency: 0,
            concurrencyHistory: []
        };
        
        this.metrics.driverMetrics.clear();
        
        this.metrics.errorBreakdown = {
            network: 0,
            timeout: 0,
            api: 0,
            data: 0,
            unknown: 0
        };
        
        this.metrics.comparison = {
            individualRequests: {
                totalTime: 0,
                requestCount: 0,
                averageTime: 0
            },
            batchRequests: {
                totalTime: 0,
                requestCount: 0,
                averageTime: 0
            },
            performanceImprovement: 0
        };
        
        this.metrics.session = {
            startTime: Date.now(),
            totalDriversProcessed: 0,
            uniqueDriversProcessed: new Set(),
            pagesProcessed: 0,
            cacheHitRate: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        console.log('PerformanceMonitor: Metrics reset');
    },
    
    // Register cleanup handlers
    registerCleanupHandlers() {
        // Generate final report on page unload
        window.addEventListener('beforeunload', () => {
            this.log('info', 'Page unloading - generating final performance report');
            this.logPerformanceReport();
            this.stopPeriodicReporting();
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.log('info', 'Page hidden - pausing performance monitoring');
            } else {
                this.log('info', 'Page visible - resuming performance monitoring');
            }
        });
    },
    
    // Get current metrics snapshot
    getMetricsSnapshot() {
        return JSON.parse(JSON.stringify({
            ...this.metrics,
            driverMetrics: Array.from(this.metrics.driverMetrics.entries()),
            session: {
                ...this.metrics.session,
                uniqueDriversProcessed: Array.from(this.metrics.session.uniqueDriversProcessed)
            }
        }));
    },
    
    // Export metrics to JSON
    exportMetrics() {
        const snapshot = this.getMetricsSnapshot();
        const exportData = {
            timestamp: new Date().toISOString(),
            version: '1.0',
            metrics: snapshot,
            report: this.generatePerformanceReport()
        };
        
        return JSON.stringify(exportData, null, 2);
    },
    
    // Cleanup and finalize
    cleanup() {
        this.log('info', 'Cleaning up performance monitor');
        this.stopPeriodicReporting();
        this.logPerformanceReport();
        console.log('PerformanceMonitor: Cleanup completed');
    }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.PerformanceMonitor = PerformanceMonitor;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PerformanceMonitor };
}