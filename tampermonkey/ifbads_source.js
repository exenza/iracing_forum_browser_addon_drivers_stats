// ==UserScript==
// @name         iR Forum user stats
// @namespace    http://tampermonkey.net/
// @version      2.1_2025-12-24
// @description  Show user stats in the iRacing forum
// @author       Max (refactored MR ver
// @match        https://forums.iracing.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=iracing.com
// @downloadURL  https://raw.githubusercontent.com/exenza/iracing_forum_browser_addon_drivers_stats/refs/heads/main/tampermonkey/ifbads_source.js
// @updateURL    https://raw.githubusercontent.com/exenza/iracing_forum_browser_addon_drivers_stats/refs/heads/main/tampermonkey/ifbads_source.js
// ==/UserScript==

'use strict';

// Start User Configuration

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const RECENT_EVENTS_COUNT = 2; // Number of recent events to display
const RECENT_EVENTS_TYPES = ['RACE']; // Event types to display: 'RACE', 'PRACTICE', 'HOSTED', 'LEAGUE'

// End user configuration

const API_ENDPOINT = 'https://ncv5ut7oz0.execute-api.eu-central-1.amazonaws.com/dev';
const cache = new Map();

// Simple API fetch for single driver
async function fetchSingleDriver(name) {
    if (!name || !name.trim()) {
        console.log('No valid name provided to fetchSingleDriver');
        return null;
    }
    
    const url = `${API_ENDPOINT}/drivers?names=${encodeURIComponent(name.trim())}`;
    console.log('Fetching driver:', name);
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data[name] || null;
    } catch (error) {
        console.error('API Error for', name, ':', error);
        return null;
    }
}

// Cache helpers
function getCached(name) {
    const cached = cache.get(name);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    cache.delete(name);
    return null;
}

function setCached(name, data) {
    cache.set(name, { data, timestamp: Date.now() });
}// SVG icons for license categories
const svgIcons = {
    oval: ' viewBox="-2 -1.55 28 18"><path d="m18 3h-12c-1.6568 0-3 1.3432-3 3v0.7918c0 1.1363 0.64201 2.1751 1.6584 2.6833l2.6459 1.3229c2.956 1.478 6.4354 1.478 9.3914 0l2.6459-1.3229c1.0164-0.5082 1.6584-1.547 1.6584-2.6833v-0.7918c0-1.6568-1.3431-3-3-3zm-12-3h12c3.3137 0 6 2.6863 6 6v0.7918c0 2.2726-1.284 4.3502-3.3167 5.3666l-2.6459 1.3229c-3.8006 1.9003-8.2742 1.9003-12.075 0l-2.6459-1.3229c-2.0327-1.0164-3.3167-3.094-3.3167-5.3666v-0.7918c0-3.3137 2.6863-6 6-6z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    sports_car: ' viewBox="-2 -2 28 18"><path d="m22.5 5.25h-0.8785l-1.5-1.75h0.8785c0.8284 0 1.5-0.78349 1.5-1.75h-3.8785l-0.6213-0.72487c-0.5626-0.65637-1.3256-1.0251-2.1213-1.0251h-7.7574c-0.79565 0-1.5587 0.36875-2.1213 1.0251l-0.62132 0.72487h-3.8789c0 0.9665 0.67157 1.75 1.5 1.75h0.87891l-1.5 1.75h-0.87891c-0.82843 0-1.5 0.78353-1.5 1.75v5.25c0 0.96646 0.67157 1.75 1.5 1.75h1.5c0.82843 0 1.5-0.78353 1.5-1.75h15c0 0.96646 0.6716 1.75 1.5 1.75h1.5c0.8284 0 1.5-0.78353 1.5-1.75v-5.25c0-0.96646-0.6716-1.75-1.5-1.75zm-2.9998 0h-15l2.5604-2.9874c0.2813-0.32819 0.66284-0.51256 1.0607-0.51256h7.7574c0.3978 0 0.7793 0.18438 1.0606 0.51256zm-10.94 2.2625-0.75 0.875c-0.19891 0.23217-0.31066 0.54681-0.31066 0.875 0 0.68343 0.47487 1.2375 1.0607 1.2375h6.8786c0.5858 0 1.0607-0.55405 1.0607-1.2375 0-0.32818-0.1117-0.64283-0.3107-0.875l-0.75-0.875c-0.2813-0.32818-0.6628-0.51251-1.0606-0.51251h-4.7574c-0.39782 0-0.77935 0.18433-1.0607 0.51251zm-3.7678 0.89576c-0.18753 0.21875-0.44189 0.34171-0.7071 0.34171h-1.0858v-1.75h3zm16.207 0.34171h-1.0858c-0.2652 0-0.5196-0.12297-0.7071-0.34171l-1.2071-1.4083h3z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" stroke-width="1.0801"/></svg>',
    formula_car: ' viewBox="-2 -1 28 18"><path d="m8.9538 4.3636h-1.4538c-0.82843 0-1.5 0.65121-1.5 1.4545v1.9394l-1.5 0.48484v-0.96969c0-0.80329-0.67157-1.4545-1.5-1.4545h-1.5c-0.82843 0-1.5 0.65124-1.5 1.4545v4.3636c0 0.80329 0.67157 1.4545 1.5 1.4545h1.5c0.82843 0 1.5-0.65124 1.5-1.4545v-1.9394l1.53931.284 4.3502-3.3167 5.3666l-2.6459 1.3229c-3.8006 1.9003-8.2742 1.9003-12.075 0l-2.6459-1.3229c-2.0327-1.0164-3.3167-3.094-3.3167-5.3666v-0.7918c0-3.3137 2.6863-6 6-6z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    sports_car: ' viewBox="-2 -2 28 18"><path d="m22.5 5.25h-0.8785l-1.5-1.75h0.8785c0.8284 0 1.5-0.78349 1.5-1.75h-3.8785l-0.6213-0.72487c-0.5626-0.65637-1.3256-1.0251-2.1213-1.0251h-7.7574c-0.79565 0-1.5587 0.36875-2.1213 1.0251l-0.62132 0.72487h-3.8789c0 0.9665 0.67157 1.75 1.5 1.75h0.87891l-1.5 1.75h-0.87891c-0.82843 0-1.5 0.78353-1.5 1.75v5.25c0 0.96646 0.67157 1.75 1.5 1.75h1.5c0.82843 0 1.5-0.78353 1.5-1.75h15c0 0.96646 0.6716 1.75 1.5 1.75h1.5c0.8284 0 1.5-0.78353 1.5-1.75v-5.25c0-0.96646-0.6716-1.75-1.5-1.75zm-2.9998 0h-15l2.5604-2.9874c0.2813-0.32819 0.66284-0.51256 1.0607-0.51256h7.7574c0.3978 0 0.7793 0.18438 1.0606 0.51256zm-10.94 2.2625-0.75 0.875c-0.19891 0.23217-0.31066 0.54681-0.31066 0.875 0 0.68343 0.47487 1.2375 1.0607 1.2375h6.8786c0.5858 0 1.0607-0.55405 1.0607-1.2375 0-0.32818-0.1117-0.64283-0.3107-0.875l-0.75-0.875c-0.2813-0.32818-0.6628-0.51251-1.0606-0.51251h-4.7574c-0.39782 0-0.77935 0.18433-1.0607 0.51251zm-3.7678 0.89576c-0.18753 0.21875-0.44189 0.34171-0.7071 0.34171h-1.0858v-1.75h3zm16.207 0.34171h-1.0858c-0.2652 0-0.5196-0.12297-0.7071-0.34171l-1.2071-1.4083h3z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" stroke-width="1.0801"/></svg>',
    formula_car: ' viewBox="-2 -1 28 18"><path d="m8.9538 4.3636h-1.4538c-0.82843 0-1.5 0.65121-1.5 1.4545v1.9394l-1.5 0.48484v-0.96969c0-0.80329-0.67157-1.4545-1.5-1.4545h-1.5c-0.82843 0-1.5 0.65124-1.5 1.4545v4.3636c0 0.80329 0.67157 1.4545 1.5 1.4545h1.5c0.82843 0 1.5-0.65124 1.5-1.4545v-1.9394l1.5393-0.49755c0.23262 1.3821 1.4696 2.4369 2.9607 2.4369h0.85714l0.21426 1.4545h-5.5714c0 0.80329 0.67157 1.4545 1.5 1.4545h4.2857l0.0022 0.01464c0.1217 0.82618 0.8514 1.4399 1.7121 1.4399s1.5904-0.61372 1.7121-1.4399l0.0022-0.01464h4.2857c0.8284 0 1.5-0.65124 1.5-1.4545h-5.5714l0.2143-1.4545h0.8571c1.4911 0 2.7281-1.0548 2.9607-2.4369l1.5393 0.49755v1.9394c0 0.80329 0.6716 1.4545 1.5 1.4545h1.5c0.8284 0 1.5-0.65124 1.5-1.4545v-4.3636c0-0.80329-0.6716-1.4545-1.5-1.4545h-1.5c-0.8284 0-1.5 0.65124-1.5 1.4545v0.96969l-1.5-0.48484v-1.9394c0-0.80332-0.6716-1.4545-1.5-1.4545h-1.4539l-0.375-1.4545h4.8289c0.8284 0 1.5-0.65121 1.5-1.4545h-6.7039l-0.0199-0.077333c-0.2087-0.80939-0.9586-1.3772-1.819-1.3772h-0.9144c-0.8604 0-1.6104 0.56781-1.819 1.3772l-0.01994 0.077333h-6.7038c0 0.80332 0.67157 1.4545 1.5 1.4545h4.8288zm6.0462 1.4545h1.5v2.9091c0 0.80329-0.6716 1.4545-1.5 1.4545h-0.6429zm-4.5-1.4545h3l-0.679-2.6336c-0.0417-0.16188-0.1917-0.27544-0.3638-0.27544h-0.9144c-0.1721 0-0.3221 0.11356-0.3638 0.27544zm-1.5 1.4545h-1.5v2.9091c0 0.80329 0.67157 1.4545 1.5 1.4545h0.64286z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" stroke-width=".98473"/></svg>',
    dirt_oval: ' viewBox="-2 0 28 18"><path d="m8 0h8c3.7712 0 5.6569 0 6.8284 1.1716 1.1716 1.1716 1.1716 3.0572 1.1716 6.8284v2c0 3.7712 0 5.6569-1.1716 6.8284-1.1715 1.1716-3.0572 1.1716-6.8284 1.1716h-8c-3.7712 0-5.6568 0-6.8284-1.1716-1.1716-1.1715-1.1716-3.0572-1.1716-6.8284v-2c0-3.7712 0-5.6568 1.1716-6.8284s3.0572-1.1716 6.8284-1.1716zm1 6h6c1.6569 0 3 1.3431 3 3s-1.3431 3-3 3h-6c-1.6568 0-3-1.3431-3-3s1.3432-3 3-3zm6-3h-6c-3.3137 0-6 2.6863-6 6s2.6863 6 6 6h6c3.3137 0 6-2.6863 6-6s-2.6863-6-6-6z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    dirt_road: ' viewBox="-2 0 28 18"><path d="m8 0h8c3.7712 0 5.6569 0 6.8284 1.1716 1.1716 1.1716 1.1716 3.0572 1.1716 6.8284v2c0 3.7712 0 5.6569-1.1716 6.8284-1.1715 1.1716-3.0572 1.1716-6.8284 1.1716h-8c-3.7712 0-5.6568 0-6.8284-1.1716-1.1716-1.1715-1.1716-3.0572-1.1716-6.8284v-2c0-3.7712 0-5.6568 1.1716-6.8284s3.0572-1.1716 6.8284-1.1716zm-2 15h-3v-9c0-1.6568 1.3432-3 3-3h4.5c1.6569 0 3 1.3432 3 3v4c0 1.1046 0.8954 2 2 2h0.5c1.1046 0 2-0.8954 2-2v-7h3v9c0 1.6569-1.3431 3-3 3h-4.5c-1.6569 0-3-1.3431-3-3v-4c0-1.1046-0.89543-2-2-2h-0.5c-1.1046 0-2 0.89543-2 2z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    undefined: ' viewBox="0 0 1 18"></svg>'
};

// Simple category detection from car name
function getCarCategory(carName) {
    const name = carName.toLowerCase();
    if (name.includes('formula') || name.includes('f1') || name.includes('f2') || name.includes('f3') || 
        name.includes('indy') || name.includes('dallara') || name.includes('skip barber') || 
        name.includes('lotus 79') || name.includes('williams') || name.includes('mclaren mp4')) {
        return 'formula_car';
    }
    if (name.includes('dirt') && (name.includes('oval') || name.includes('sprint') || name.includes('late model') || 
        name.includes('modified') || name.includes('midget') || name.includes('street stock'))) {
        return 'dirt_oval';
    }
    if (name.includes('dirt') || name.includes('rally') || name.includes('beetle') || name.includes('fiesta') || 
        name.includes('wrx') || name.includes('pro 2') || name.includes('pro 4')) {
        return 'dirt_road';
    }
    if (name.includes('nascar') || name.includes('oval') || name.includes('legends') || name.includes('modified') || 
        name.includes('sprint car') || name.includes('silver crown') || name.includes('street stock') || 
        name.includes('late model') || name.includes('truck')) {
        return 'oval';
    }
    return 'sports_car'; // Default for GT3, GTE, sports cars, etc.
}

// Helper functions
function yearsSince(dateStr) {
    const years = (Date.now() - new Date(dateStr)) / (1000 * 60 * 60 * 24 * 365.25);
    return Math.floor(years);
}

// Generate license display
function renderLicenses(driver) {
    if (!driver.member_info?.licenses) return '';
    
    const licenses = driver.member_info.licenses.map(lic => {
        const className = lic.group_name.replace('Class ', '').replace('Rookie', 'R').replace('Pro', 'P');
        const category = lic.category || 'undefined';
        return `<div class="license-link license-color-${className}">
            <svg class="ir-cat-svg"${svgIcons[category]}
            ${className}${lic.safety_rating} ${lic.irating}
        </div>`;
    }).join(' ');
    
    return `<div class="dispflex fs90">${licenses}</div>`;
}

// Generate driver info
function renderDriverInfo(driver, driverName) {
    if (!driver.member_info) return '';
    
    const memberYears = yearsSince(driver.member_info.member_since);
    const custId = driver.cust_id;
    const encodedName = encodeURIComponent(driverName);
    
    return `
        <b>${driver.member_info.country}</b> &nbsp;
        <span title="Member since: ${driver.member_info.member_since}">Member: ${memberYears} years</span> &nbsp;
        Followers: ${driver.follow_counts.followers}/${driver.follow_counts.follows} &nbsp;
        <a target="_blank" href="https://members-ng.iracing.com/web/racing/profile?cust_id=${custId}" class="driver-link">Profile</a> &nbsp;
        <a target="_blank" href="https://nyoom.app/search/${custId}" class="driver-link">NYOOM</a> &nbsp;
        <a target="_blank" href="https://www.irstats.net/driver/${custId}" class="driver-link">iRStats</a> &nbsp;
        <a target="_blank" href="https://iracingdata.com/user/careerstats/${custId}" class="driver-link">iRdata</a> &nbsp;
        <a target="_blank" href="https://season-summary.dyczkowski.dev/driver/${custId}?category=sports_car" class="driver-link">SSummary</a> &nbsp;
        <a target="_blank" href="https://simracer-tools.com/seasonstandings/?driver=${custId}&stats=1" class="driver-link">SStandings</a> &nbsp;
        <a target="_blank" href="https://members-ng.iracing.com/web/racing/results-stats/results" onclick="navigator.clipboard.writeText('${custId}');" class="driver-link">Results</a> &nbsp;
        <a target="_blank" href="${API_ENDPOINT}/drivers?names=${encodedName}" class="driver-link">API</a> &nbsp;
    `;
}

// Generate recent events
function renderRecentEvents(driver) {
    if (!driver.recent_events?.length) return '<b>No recent events.</b>';
    
    // Filter events by configured types
    const filteredEvents = driver.recent_events.filter(event => 
        RECENT_EVENTS_TYPES.includes(event.event_type)
    );
    
    if (!filteredEvents.length) return '<b>No recent events of selected types.</b>';
    
    const events = filteredEvents.slice(0, RECENT_EVENTS_COUNT).map(event => {
        const carCategory = getCarCategory(event.car_name);
        const eventType = event.event_type[0];
        const date = event.start_time.slice(2, 10);
        const time = event.start_time.slice(12, 16);
        const pos = event.finish_position !== undefined && event.finish_position >= 0 ? ` F${event.finish_position + 1}` : '';
        
        return `<span class="border777">
            <svg class="recent-svg"${svgIcons[carCategory]}
            <a target="_blank" class="driver-link monospace" href="https://members-ng.iracing.com/web/racing/profile?subsessionid=${event.subsession_id}">
                ${eventType} ${date} ${time}
            </a>
            <a target="_blank" class="driver-link" href="https://members.iracing.com/membersite/member/EventResult.do?subsessionid=${event.subsession_id}">
                ${event.car_name}${pos}
            </a>
        </span>`;
    });
    
    // Group events into pairs for two per line
    const lines = [];
    for (let i = 0; i < events.length; i += 2) {
        const line = events.slice(i, i + 2).join(' ');
        lines.push(line);
    }
    
    return `<span class="fs90">${lines.join('<br>')}</span>`;
}

// Prevent multiple executions
let addonInitialized = false;

// Main execution with Chrome compatibility
function initializeAddon() {
    if (addonInitialized) {
        console.log('Addon already initialized, skipping');
        return;
    }
    
    const authors = document.getElementsByClassName('Author');
    
    // Check if authors already have stats loaded
    let hasExistingStats = false;
    for (const author of authors) {
        if (author.querySelector('.loadingstats')) {
            hasExistingStats = true;
            break;
        }
    }
    
    if (hasExistingStats) {
        console.log('Stats already loaded, skipping initialization');
        return;
    }
    
    addonInitialized = true;
    console.log('Initializing addon - Found', authors.length, 'author elements');
    
    const driverNames = [];
    const driverElements = new Map();
    
    // Collect driver names and elements
    for (const author of authors) {
        // Try multiple selectors for Chrome compatibility
        let nameElement = author.getElementsByTagName('a')[0];
        if (!nameElement) {
            nameElement = author.querySelector('a');
        }
        if (!nameElement) {
            nameElement = author.querySelector('.Username a');
        }
        if (!nameElement) {
            nameElement = author.querySelector('[data-username]');
        }
        
        if (!nameElement) {
            console.log('No name element found in author:', author);
            continue;
        }
        
        // Try multiple ways to get the name
        let rawName = nameElement.innerText || nameElement.textContent || nameElement.getAttribute('data-username') || '';
        
        // Clean up the name
        const driverName = rawName.replace(/Loading\s*\n*\s*/g, '').replace(/\s+/g, ' ').trim();
        console.log('Raw name:', rawName, '-> Cleaned name:', driverName);
        
        // Skip if no valid name found
        if (!driverName || driverName.length < 2) {
            console.log('Skipping invalid name:', driverName);
            continue;
        }
        
        driverNames.push(driverName);
        
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'loadingstats fwb';
        loadingDiv.innerHTML = '<div class="loading-bar-container"><div class="loading-bar"></div></div>';
        author.appendChild(loadingDiv);
        
        if (!driverElements.has(driverName)) {
            driverElements.set(driverName, []);
        }
        driverElements.get(driverName).push(loadingDiv);
    }
    
    // Remove duplicates and filter out empty names
    const uniqueNames = [...new Set(driverNames)].filter(name => name && name.trim());
    
    // Only proceed if we have valid driver names
    if (uniqueNames.length === 0) {
        console.log('No driver names found on page');
        return;
    }
    
    console.log('Found drivers:', uniqueNames);
    
    // Process each driver individually
    uniqueNames.forEach(async (name) => {
        const elements = driverElements.get(name) || [];
        
        // Check cache first
        const cached = getCached(name);
        if (cached) {
            // Render cached data immediately
            elements.forEach(element => {
                if (cached.member_info) {
                    element.innerHTML = `
                        <div class="fwn theme-font-color">${renderDriverInfo(cached, name)}</div>
                        ${renderLicenses(cached)}
                        <div class="theme-font-color">${renderRecentEvents(cached)}</div>
                    `;
                } else {
                    element.innerHTML = '<span class="error-message fs90">Stats unavailable</span>';
                }
            });
        } else {
            // Fetch individual driver data
            try {
                const driver = await fetchSingleDriver(name);
                if (driver) {
                    setCached(name, driver);
                    
                    elements.forEach(element => {
                        if (driver.member_info) {
                            element.innerHTML = `
                                <div class="fwn theme-font-color">${renderDriverInfo(driver, name)}</div>
                                ${renderLicenses(driver)}
                                <div class="theme-font-color">${renderRecentEvents(driver)}</div>
                            `;
                        } else {
                            element.innerHTML = '<span class="error-message fs90">Stats unavailable</span>';
                        }
                    });
                } else {
                    elements.forEach(element => {
                        element.innerHTML = '<span class="error-message fs90">Stats unavailable</span>';
                    });
                }
            } catch (error) {
                console.error('Failed to fetch driver data for', name, ':', error);
                elements.forEach(element => {
                    element.innerHTML = '<span class="error-message fs90">Stats unavailable</span>';
                });
            }
        }
    });
}

// Initialize with proper timing for Chrome - but only once
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAddon);
} else {
    // DOM already loaded
    initializeAddon();
}

// Additional fallback for Chrome - try again after a short delay
setTimeout(() => {
    if (!addonInitialized) {
        console.log('Fallback initialization attempt');
        initializeAddon();
    }
}, 1000);

// Add styles
const style = document.createElement('style');
style.textContent = `
    .driver-link { color: inherit !important; font-size: inherit !important; font-weight: normal !important; }
    .license-link { border-radius: 6px; font-weight: bold; text-align: center; line-height: 1; margin-right: 0.5em; padding-inline: 0.3em; }
    .license-color-R { border: 1px solid #E1251B; background-color: #F3A8A4; color: #5D1214; }
    .license-color-D { border: 1px solid #FF6600; background-color: #FFC299; color: #692C09; }
    .license-color-C { border: 1px solid #FFCC00; background-color: #FFEB99; color: #50410A; }
    .license-color-B { border: 1px solid #33CC00; background-color: #ADEB99; color: #175509; }
    .license-color-A { border: 1px solid #006EFF; background-color: #99C5FF; color: #032F6F; }
    .license-color-P { border: 1px solid #828287; background-color: #CDCDCF; color: #37373F; }
    .ir-cat-svg { height: 1.4em; vertical-align: text-top; margin-right: 0.3em; }
    .recent-svg { height: 1.4em; vertical-align: text-top; margin-inline: 0.2em; }
    .fwb { font-weight: bold; }
    .fwn { font-weight: normal; }
    .fs90 { font-size: 90%; }
    .theme-font-color { color: var(--theme-font-color); }
    .monospace { font-family: monospace; }
    .border777 { border: 1px solid #777; border-radius: 6px; }
    .dispflex { display: flex; }
    .error-message { color: #cc6666; font-style: italic; }
    .loading-bar-container { 
        width: 100%; 
        height: 4px; 
        background-color: #333; 
        border-radius: 2px; 
        overflow: hidden; 
        margin: 2px 0; 
    }
    .loading-bar { 
        height: 100%; 
        background: linear-gradient(90deg, #006EFF, #33CC00); 
        width: 0%; 
        animation: loadingProgress 20s linear forwards; 
        border-radius: 2px; 
    }
    @keyframes loadingProgress { 
        from { width: 0%; } 
        to { width: 100%; } 
    }
    .loadingstats { min-height: 20px; }
`;
document.head.appendChild(style);