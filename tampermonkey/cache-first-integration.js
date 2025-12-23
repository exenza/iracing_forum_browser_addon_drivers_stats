// Cache-First Integration for iRacing Forum Browser Extension
// Integrates enhanced cache operations with the main driver loading system

// Enhanced driver data fetching with cache-first concurrent loading
async function fetchDriverDataCacheFirst(driverNames) {
    if (!Array.isArray(driverNames) || driverNames.length === 0) {
        console.warn('fetchDriverDataCacheFirst: Invalid driver names provided');
        return {};
    }

    console.log(`Starting cache-first fetch for ${driverNames.length} drivers: ${driverNames.join(', ')}`);
    
    try {
        // Step 1: Check cache for each driver individually
        const cachedData = {};
        const uncachedNames = [];

        driverNames.forEach(name => {
            const cached = EnhancedCacheManager.getDriver(name);
            if (cached) {
                cachedData[name] = cached;
                console.log(`Cache hit for driver: ${name}`);
            } else {
                uncachedNames.push(name);
                console.log(`Cache miss for driver: ${name}`);
            }
        });

        // Step 2: Display cached drivers immediately
        if (Object.keys(cachedData).length > 0) {
            console.log(`Displaying ${Object.keys(cachedData).length} cached drivers immediately`);
            
            // Render cached data immediately
            setTimeout(() => {
                render(cachedData, document.getElementsByClassName('AuthorWrap'));
            }, 0);
        }

        // Step 3: If all drivers are cached, return immediately
        if (uncachedNames.length === 0) {
            console.log('All drivers found in cache, no API requests needed');
            return cachedData;
        }

        // Step 4: Make concurrent individual requests for uncached drivers
        console.log(`Making concurrent individual requests for ${uncachedNames.length} uncached drivers`);
        
        const apiData = await CacheFirstConcurrentManager.fetchAllDrivers(uncachedNames);

        // Step 5: Cache individual driver responses as they complete using concurrent cache storage
        const cacheStats = await ConcurrentCacheStorage.handleConcurrentCacheOperations(apiData);
        console.log(`Concurrent cache operations completed: ${cacheStats.cached} cached, ${cacheStats.skipped} skipped, ${cacheStats.errors} errors`);

        // Step 6: Combine cached and API data
        const combinedData = { ...cachedData, ...apiData };
        
        console.log(`Cache-first fetch completed: ${Object.keys(cachedData).length} cached, ${Object.keys(apiData).length} from API`);
        
        return combinedData;

    } catch (error) {
        console.error('fetchDriverDataCacheFirst error:', error);
        
        // Fallback to cached data if available
        const cachedData = {};
        driverNames.forEach(name => {
            const cached = EnhancedCacheManager.getDriver(name);
            if (cached) {
                cachedData[name] = cached;
            } else {
                // Create error entry for uncached drivers
                cachedData[name] = {
                    error: true,
                    errorType: 'api',
                    errorMessage: 'Stats unavailable - please try again later',
                    driverName: name
                };
            }
        });
        
        return cachedData;
    }
}

// Enhanced render function that handles progressive display
function renderWithProgressiveDisplay(data, author_wrap) {
    if (!data || typeof data !== 'object') {
        console.warn('renderWithProgressiveDisplay: Invalid data provided');
        return;
    }

    // Process each unique driver in the data
    Object.keys(data).forEach(driverName => {
        const member = data[driverName];
        
        // Get all elements associated with this driver
        const associatedElements = RequestDeduplicationManager.getElementsForDriver(driverName);
        
        if (associatedElements.length === 0) {
            console.warn(`No elements found for driver: ${driverName}`);
            return;
        }
        
        // Update all elements for this driver
        RequestDeduplicationManager.updateAllElementsForDriver(driverName, (element, currentDriver) => {
            // Find the author element that contains this loading element
            let author = element.closest('.Author') || element.parentElement;
            while (author && !author.classList.contains('Author')) {
                author = author.parentElement;
            }
            
            if (!author) {
                console.warn(`Could not find author element for driver: ${currentDriver}`);
                return;
            }
            
            let driver_stats = '';

            try {
                // Check if this driver has an error
                if (member && member.error) {
                    // Show error for this specific element
                    LoadingManager.showErrorForElement(element, member.errorMessage);
                    return;
                } else if (member?.member_info) {
                    // Normal rendering for successful data
                    let driver_recent = driver_recent_events(member);
                    driver_stats += '<span class="fwn theme-font-color">'+ driver_infos(member) + '</span>';
                    driver_stats += '<div class="dispflex fs90">'+ driver_licenses(member) + '</div>';
                    driver_stats += '<div class="dispflex theme-font-color">'
                    
                    // Generate unique ID for this specific element instance
                    const elementId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    
                    driver_stats += '<div id="recent_switch_'+ elementId +'" class="noselect"> <b> Recent: </b>&nbsp;</div>';
                    driver_stats += '<div id="recent_cars_html_'+ elementId +'" class="fwn" style="display: inline;">';
                    if (show_max_recent_cars > 0) {
                        driver_stats += driver_recent.cars;
                    } else {
                        driver_stats += 'No recent cars!';
                    }
                    driver_stats += '</div><div id="recent_events_html_'+ elementId +'" class="fwn" style="display: none;">';
                    if (show_max_recent_events > 0) {
                        driver_stats += driver_recent.events;
                    } else {
                        driver_stats += 'No recent events!';
                    }
                    driver_stats += '</div>';
                    
                    // Add event listener for this specific instance
                    setTimeout(() => {
                        const recent_switch = document.querySelector('#recent_switch_'+ elementId);
                        if (recent_switch) {
                            recent_switch.addEventListener('click', function() {
                                const recent_events_html = document.querySelector('#recent_events_html_'+ elementId);
                                const recent_cars_html = document.querySelector('#recent_cars_html_'+ elementId);
                                if (recent_events_html && recent_cars_html) {
                                    if (recent_events_html.style.display == 'none') {
                                        recent_events_html.style.display = 'inline';
                                        recent_cars_html.style.display = 'none';
                                    } else {
                                        recent_events_html.style.display = 'none';
                                        recent_cars_html.style.display = 'inline';
                                    }
                                }
                            });
                        }
                    }, 100);
                    
                } else if (!member) {
                    // Driver not found in response
                    LoadingManager.showErrorForElement(element, 'Stats failed to load');
                    return;
                } else {
                    // Data exists but member_info is missing
                    console.log("Error: member.member_info is undefined or null for driver: " + JSON.stringify(currentDriver));
                    LoadingManager.showErrorForElement(element, 'Stats failed to load');
                    return;
                }
            } catch(error) {
                // Handle rendering errors gracefully
                const errorInfo = ErrorHandler.handleApiError(error, currentDriver);
                const errorMessage = errorInfo.message +
                    ' <a target="_blank" href="'+ CONFIG.API_ENDPOINT +'/drivers?names='+ currentDriver +'"> JSON </a>';
                LoadingManager.showErrorForElement(element, errorMessage);
                console.log('Render error for driver:', currentDriver);
                return;
            }

            // Use LoadingManager to properly clean up the loading state and replace content
            const statsHtml = '<div id="driver_infos" class="fwb fs12" >'+ driver_stats +'</div>';
            LoadingManager.hideLoadingForElement(element, statsHtml);
        });
    });
}

// Initialize cache-first system
function initializeCacheFirstSystem() {
    console.log('Initializing cache-first concurrent loading system...');
    
    // Initialize the enhanced concurrent request manager
    if (typeof CacheFirstConcurrentManager !== 'undefined' && CacheFirstConcurrentManager.initialize) {
        CacheFirstConcurrentManager.initialize();
    }
    
    // Initialize concurrent cache storage system
    if (typeof ConcurrentCacheStorage !== 'undefined') {
        // Reset operation statistics for fresh start
        ConcurrentCacheStorage.resetOperationStats();
        console.log('Concurrent cache storage system initialized');
    }
    
    // Cleanup expired cache entries on page load
    const cleanupResult = EnhancedCacheManager.cleanupExpired();
    console.log(`Cache cleanup on initialization: ${cleanupResult.removed} expired entries removed`);
    
    // Log cache statistics
    const cacheStats = EnhancedCacheManager.getCacheStats();
    console.log('Cache statistics:', cacheStats);
    
    console.log('Cache-first system initialized successfully');
}

// Enhanced main execution with cache-first loading
function executeWithCacheFirst(driverNames) {
    if (!Array.isArray(driverNames) || driverNames.length === 0) {
        console.warn('executeWithCacheFirst: No driver names provided');
        return;
    }
    
    console.log(`Executing cache-first loading for ${driverNames.length} drivers`);
    
    // Initialize the cache-first system
    initializeCacheFirstSystem();
    
    // Fetch driver data with cache-first approach
    fetchDriverDataCacheFirst(driverNames)
        .then((data) => {
            console.log('Cache-first fetch completed, rendering data...');
            renderWithProgressiveDisplay(data, document.getElementsByClassName('AuthorWrap'));
        })
        .catch((error) => {
            console.error('Cache-first execution error:', error);
            ErrorHandler.logError(error, { context: 'cache_first_execution' });

            // Use LoadingManager to show errors for all drivers
            driverNames.forEach(driverName => {
                const elements = RequestDeduplicationManager.getElementsForDriver(driverName);
                elements.forEach(element => {
                    LoadingManager.showErrorForElement(element, 'Stats unavailable - please try again later');
                });
            });
        });
}

// Enhanced cleanup with cache-first system
function cleanupCacheFirstSystem() {
    console.log('Cleaning up cache-first system...');
    
    // Cleanup LoadingManager and RequestDeduplicationManager
    if (typeof LoadingManager !== 'undefined' && LoadingManager.cleanup) {
        LoadingManager.cleanup();
    }
    
    if (typeof RequestDeduplicationManager !== 'undefined' && RequestDeduplicationManager.cleanup) {
        RequestDeduplicationManager.cleanup();
    }
    
    // Cleanup concurrent request manager
    if (typeof CacheFirstConcurrentManager !== 'undefined' && CacheFirstConcurrentManager.cancelPendingRequests) {
        CacheFirstConcurrentManager.cancelPendingRequests();
    }
    
    // Cleanup concurrent cache storage operations
    if (typeof ConcurrentCacheStorage !== 'undefined' && ConcurrentCacheStorage.cleanupPendingOperations) {
        const cleanupResult = ConcurrentCacheStorage.cleanupPendingOperations();
        console.log(`Concurrent cache operations cleanup: ${cleanupResult.cleanedUp} operations cleaned up`);
    }
    
    // Final cache cleanup
    const finalCleanup = EnhancedCacheManager.cleanupExpired();
    console.log(`Final cache cleanup: ${finalCleanup.removed} expired entries removed`);
    
    console.log('Cache-first system cleanup completed');
}

// Export functions for use in main script
if (typeof window !== 'undefined') {
    window.fetchDriverDataCacheFirst = fetchDriverDataCacheFirst;
    window.renderWithProgressiveDisplay = renderWithProgressiveDisplay;
    window.executeWithCacheFirst = executeWithCacheFirst;
    window.cleanupCacheFirstSystem = cleanupCacheFirstSystem;
    window.initializeCacheFirstSystem = initializeCacheFirstSystem;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fetchDriverDataCacheFirst,
        renderWithProgressiveDisplay,
        executeWithCacheFirst,
        cleanupCacheFirstSystem,
        initializeCacheFirstSystem
    };
}