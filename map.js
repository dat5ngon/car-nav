// Car Nav -- Map (Leaflet + OpenStreetMap + OSRM routing + Nominatim search)
// Depends on: app.js (prefs, $, showToast, addRecent, escapeHtml, formatDuration, formatDistance)

var map = null;
var tileLayer = null;
var satelliteLayer = null;
var routeLine = null;
var userMarker = null;
var destMarker = null;
var originMarker = null;
var navWatchId = null;
var currentStepIndex = 0;
var routeSteps = [];
var routeTotalDuration = 0;
var routeTotalDistance = 0;
var searchAbort = null; // AbortController for search requests
var fromSearchAbort = null; // AbortController for "from" search
var customOrigin = null; // { lat, lng, name } or null (use GPS)
var activeSearchField = 'to'; // 'from' or 'to' -- which field triggered search results

// OSRM public demo server (for personal use; for production use your own instance)
var OSRM_URL = 'https://router.project-osrm.org';
var NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

// ══════════════════════════════════════════════════════════════
//  Map initialization
// ══════════════════════════════════════════════════════════════

function initMap() {
    var defaultCenter = [10.8231, 106.6297]; // Ho Chi Minh City

    map = L.map('map', {
        center: defaultCenter,
        zoom: 14,
        zoomControl: false
    });

    // Add zoom control to right side
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Standard OSM tiles (free, no API key)
    tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    });

    // Satellite layer (Esri World Imagery -- free for non-commercial)
    satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri',
        maxZoom: 19
    });

    if (prefs.satelliteView) {
        satelliteLayer.addTo(map);
    } else {
        tileLayer.addTo(map);
    }

    // Custom user location icon
    var userIcon = L.divIcon({
        className: 'user-marker',
        html: '<div class="user-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    // Try to center on user
    centerOnUser();
}

// ══════════════════════════════════════════════════════════════
//  Geolocation
// ══════════════════════════════════════════════════════════════

function centerOnUser() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function(pos) {
        var loc = [pos.coords.latitude, pos.coords.longitude];
        map.setView(loc, 14);
        updateUserMarker(loc);
    }, function() {
        // Geolocation denied -- stay at default
    }, { enableHighAccuracy: true, timeout: 8000 });
}

function updateUserMarker(latLng) {
    if (!userMarker) {
        var icon = L.divIcon({
            className: 'user-marker',
            html: '<div class="user-dot"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        userMarker = L.marker(latLng, { icon: icon, zIndexOffset: 1000 }).addTo(map);
    } else {
        userMarker.setLatLng(latLng);
    }
}

// ══════════════════════════════════════════════════════════════
//  Place search (Nominatim)
// ══════════════════════════════════════════════════════════════

/**
 * Search places via Nominatim.
 * @param {string} query - search text
 * @param {'from'|'to'} field - which input triggered the search
 */
function searchPlaces(query, field) {
    field = field || 'to';
    activeSearchField = field;

    if (!query.trim()) {
        hideSearchResults();
        return;
    }

    // Cancel previous request for the relevant field
    if (field === 'from') {
        if (fromSearchAbort) fromSearchAbort.abort();
        fromSearchAbort = new AbortController();
    } else {
        if (searchAbort) searchAbort.abort();
        searchAbort = new AbortController();
    }
    var controller = field === 'from' ? fromSearchAbort : searchAbort;

    var center = map.getCenter();
    var url = NOMINATIM_URL + '/search?' + new URLSearchParams({
        q: query,
        format: 'json',
        limit: '8',
        addressdetails: '1',
        viewbox: (center.lng - 0.5) + ',' + (center.lat + 0.5) + ',' +
                 (center.lng + 0.5) + ',' + (center.lat - 0.5),
        bounded: '0'
    });

    fetch(url, {
        signal: controller.signal,
        headers: { 'Accept-Language': 'en' }
    })
    .then(function(res) { return res.json(); })
    .then(function(results) {
        if (!results || results.length === 0) {
            hideSearchResults();
            return;
        }
        showSearchResults(results);
    })
    .catch(function(err) {
        if (err.name !== 'AbortError') hideSearchResults();
    });
}

function showSearchResults(results) {
    hideSuggestionsPanel();
    var container = $('search-results');
    container.innerHTML = '';

    results.forEach(function(place) {
        var item = document.createElement('div');
        item.className = 'search-result-item';

        var name = place.display_name.split(',')[0];
        var address = place.display_name;

        item.innerHTML =
            '<div class="result-icon">' +
                '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>' +
                    '<circle cx="12" cy="10" r="3"/>' +
                '</svg>' +
            '</div>' +
            '<div class="result-text">' +
                '<div class="result-name">' + escapeHtml(name) + '</div>' +
                '<div class="result-address">' + escapeHtml(address) + '</div>' +
            '</div>';

        item.addEventListener('click', function() {
            selectPlace(place);
        });

        container.appendChild(item);
    });

    container.style.display = 'block';
}

function hideSearchResults() {
    $('search-results').style.display = 'none';
}

function selectPlace(place) {
    hideSearchResults();
    var name = place.display_name.split(',')[0];
    var address = place.display_name;
    var lat = parseFloat(place.lat);
    var lng = parseFloat(place.lon);

    if (activeSearchField === 'from') {
        // Set custom origin
        $('from-input').value = name;
        $('clear-from').style.display = 'flex';
        customOrigin = { lat: lat, lng: lng, name: name, address: address };
        setOriginMarker([lat, lng]);
        map.setView([lat, lng], 14);
    } else {
        // Set destination (existing behaviour)
        $('search-input').value = name;
        $('clear-search').style.display = 'flex';

        addRecent({
            placeId: place.osm_id || place.place_id,
            name: name,
            address: address,
            lat: lat,
            lng: lng
        });

        setDestMarker([lat, lng]);
        map.setView([lat, lng], 14);
        calculateRoute([lat, lng], name, address);
    }
}

function setDestMarker(latLng) {
    if (destMarker) map.removeLayer(destMarker);

    var icon = L.divIcon({
        className: 'dest-marker',
        html: '<div class="dest-pin"><svg viewBox="0 0 24 24" width="32" height="32" fill="#f06b6b"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div>',
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    });

    destMarker = L.marker(latLng, { icon: icon }).addTo(map);
}

function setOriginMarker(latLng) {
    if (originMarker) map.removeLayer(originMarker);

    var icon = L.divIcon({
        className: 'origin-marker',
        html: '<div class="origin-pin"><svg viewBox="0 0 24 24" width="28" height="28" fill="#5cb88a"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28]
    });

    originMarker = L.marker(latLng, { icon: icon }).addTo(map);
}

function clearCustomOrigin() {
    customOrigin = null;
    if (originMarker) {
        map.removeLayer(originMarker);
        originMarker = null;
    }
    $('from-input').value = '';
    $('clear-from').style.display = 'none';
}

function swapOriginDest() {
    var fromInput = $('from-input');
    var toInput = $('search-input');
    var fromVal = fromInput.value;
    var toVal = toInput.value;

    // Swap text
    fromInput.value = toVal;
    toInput.value = fromVal;

    // Update clear button visibility
    $('clear-from').style.display = toVal ? 'flex' : 'none';
    $('clear-search').style.display = fromVal ? 'flex' : 'none';

    // Swap data: customOrigin <-> destMarker position
    var oldOrigin = customOrigin;
    var oldDest = destMarker ? destMarker.getLatLng() : null;
    var oldDestName = toVal;

    if (oldDest) {
        // Old dest becomes new origin
        customOrigin = { lat: oldDest.lat, lng: oldDest.lng, name: toVal };
        setOriginMarker([oldDest.lat, oldDest.lng]);
    } else {
        clearCustomOrigin();
        fromInput.value = toVal; // restore text even if no marker
    }

    if (oldOrigin) {
        // Old origin becomes new dest
        setDestMarker([oldOrigin.lat, oldOrigin.lng]);
        // Recalculate route with swapped positions
        calculateRoute([oldOrigin.lat, oldOrigin.lng], oldOrigin.name || fromVal, oldOrigin.address || '');
    } else {
        // No custom origin was set -- clear dest
        if (destMarker) {
            map.removeLayer(destMarker);
            destMarker = null;
        }
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        $('route-panel').style.display = 'none';
    }
}

// Navigate to a recent destination
function navigateToRecent(recent) {
    $('search-input').value = recent.name;
    $('clear-search').style.display = 'flex';
    $('recent-modal').style.display = 'none';
    closeMenu();

    var latLng = [recent.lat, recent.lng];
    setDestMarker(latLng);
    map.setView(latLng, 14);
    calculateRoute(latLng, recent.name, recent.address);
}

// ══════════════════════════════════════════════════════════════
//  Routing (OSRM)
// ══════════════════════════════════════════════════════════════

function calculateRoute(destLatLng, destName, destAddress) {
    // If custom origin is set, use it directly; otherwise fall back to GPS
    if (customOrigin) {
        _fetchRoute([customOrigin.lat, customOrigin.lng], destLatLng, destName, destAddress);
    } else {
        if (!navigator.geolocation) {
            showToast('Geolocation not available', 'error');
            return;
        }
        navigator.geolocation.getCurrentPosition(function(pos) {
            var origin = [pos.coords.latitude, pos.coords.longitude];
            updateUserMarker(origin);
            _fetchRoute(origin, destLatLng, destName, destAddress);
        }, function() {
            showToast('Could not get your location', 'error');
        }, { enableHighAccuracy: true, timeout: 8000 });
    }
}

/** Internal: fetch OSRM route between two [lat,lng] points */
function _fetchRoute(originLatLng, destLatLng, destName, destAddress) {
    // Build OSRM URL: /route/v1/driving/lng,lat;lng,lat
    var coords = originLatLng[1] + ',' + originLatLng[0] + ';' + destLatLng[1] + ',' + destLatLng[0];

    var params = new URLSearchParams({
        overview: 'full',
        geometries: 'geojson',
        steps: 'true',
        annotations: 'false'
    });

    // OSRM doesn't support avoid options directly, but we include the preference
    // for future use with a custom OSRM instance
    var url = OSRM_URL + '/route/v1/driving/' + coords + '?' + params;

    fetch(url)
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                showToast('Could not find route', 'error');
                return;
            }

            var route = data.routes[0];
            routeTotalDuration = route.duration; // seconds
            routeTotalDistance = route.distance; // meters

            // Draw route on map
            if (routeLine) map.removeLayer(routeLine);
            routeLine = L.geoJSON(route.geometry, {
                style: {
                    color: '#00b8ff',
                    weight: 10,
                    opacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(map);

            // Parse steps
            routeSteps = [];
            if (route.legs) {
                route.legs.forEach(function(leg) {
                    if (leg.steps) {
                        leg.steps.forEach(function(step) {
                            var stepCoords = step.geometry.coordinates;
                            var endCoord = stepCoords[stepCoords.length - 1];
                            routeSteps.push({
                                instruction: buildInstruction(step),
                                maneuver: step.maneuver ? step.maneuver.type : '',
                                modifier: step.maneuver ? (step.maneuver.modifier || '') : '',
                                distance: step.distance,
                                duration: step.duration,
                                endLat: endCoord[1],
                                endLng: endCoord[0]
                            });
                        });
                    }
                });
            }

            // Track destination for "save to fav" button
            lastRouteDest = {
                name: destName,
                address: destAddress || '',
                lat: destLatLng[0],
                lng: destLatLng[1]
            };

            // Show route panel
            $('route-duration').textContent = formatDuration(routeTotalDuration);
            $('route-distance').textContent = formatDistance(routeTotalDistance);
            $('route-dest').textContent = destName + (destAddress ? ' -- ' + destAddress : '');

            $('route-panel').style.display = 'block';
            $('search-bar').style.display = 'none';

            // Update favourite star icon state
            updateFavButtonState();

            // Fit map to route
            map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
        })
        .catch(function() {
            showToast('Routing failed -- check your connection', 'error');
        });
}

// Build human-readable instruction from OSRM step
function buildInstruction(step) {
    var type = step.maneuver ? step.maneuver.type : '';
    var modifier = step.maneuver ? (step.maneuver.modifier || '') : '';
    var name = step.name || '';

    var instruction = '';

    switch (type) {
        case 'depart':
            instruction = 'Head ' + modifier;
            break;
        case 'arrive':
            instruction = 'Arrive at destination';
            break;
        case 'turn':
            instruction = 'Turn ' + modifier.replace(' ', ' ');
            break;
        case 'new name':
        case 'continue':
            instruction = 'Continue';
            break;
        case 'merge':
            instruction = 'Merge ' + modifier;
            break;
        case 'on ramp':
        case 'off ramp':
            instruction = 'Take the ramp ' + modifier;
            break;
        case 'fork':
            instruction = 'Keep ' + modifier + ' at fork';
            break;
        case 'end of road':
            instruction = 'Turn ' + modifier;
            break;
        case 'roundabout':
        case 'rotary':
            var exit = step.maneuver.exit || '';
            instruction = 'Take exit ' + exit + ' at roundabout';
            break;
        default:
            instruction = modifier ? modifier.charAt(0).toUpperCase() + modifier.slice(1) : 'Continue';
    }

    if (name && type !== 'arrive') {
        instruction += ' onto ' + name;
    }

    return instruction;
}

// ══════════════════════════════════════════════════════════════
//  Turn-by-turn navigation
// ══════════════════════════════════════════════════════════════

function startNavigation() {
    if (!lastRouteDest) return;

    // Check if running inside the native Datcraft app
    if (window.Datcraft && window.Datcraft.startNavigation) {
        window.Datcraft.startNavigation(
            lastRouteDest.lat,
            lastRouteDest.lng,
            lastRouteDest.name || ''
        );
        return;
    }

    var destCoords = lastRouteDest.lat + ',' + lastRouteDest.lng;
    var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile && /Android/i.test(navigator.userAgent)) {
        // Android: use google.navigation intent to launch Google Maps navigation directly
        var navUrl = 'google.navigation:q=' + destCoords + '&mode=d';
        window.location.href = navUrl;
    } else if (isMobile) {
        // iOS: use comgooglemaps scheme, fall back to web URL
        var iosUrl = 'comgooglemaps://?daddr=' + destCoords + '&directionsmode=driving&navigate=yes';
        var webUrl = 'https://www.google.com/maps/dir/?api=1&destination=' +
            encodeURIComponent(destCoords) + '&travelmode=driving&dir_action=navigate';

        // Try native app first, fall back to web
        var fallbackTimer = setTimeout(function() {
            window.open(webUrl, '_blank');
        }, 1500);

        window.location.href = iosUrl;

        // If the app opened, cancel the fallback
        window.addEventListener('blur', function onBlur() {
            clearTimeout(fallbackTimer);
            window.removeEventListener('blur', onBlur);
        });
    } else {
        // Desktop: open Google Maps directions (navigation mode not available on desktop web)
        var gmapUrl = 'https://www.google.com/maps/dir/?api=1&destination=' +
            encodeURIComponent(destCoords) + '&travelmode=driving';

        if (customOrigin) {
            var origin = customOrigin.lat + ',' + customOrigin.lng;
            gmapUrl += '&origin=' + encodeURIComponent(origin);
        }

        window.open(gmapUrl, '_blank');
    }
}

function advanceStep(userPos) {
    if (currentStepIndex >= routeSteps.length) return;

    var step = routeSteps[currentStepIndex];
    var dist = haversineDistance(userPos[0], userPos[1], step.endLat, step.endLng);

    if (dist < 50) {
        currentStepIndex++;
        if (currentStepIndex >= routeSteps.length) {
            $('nav-distance').textContent = 'Arrived!';
            $('nav-direction').textContent = 'You have reached your destination';
            updateNavIcon('arrive', '');
        } else {
            updateNavInstruction();
        }
    }

    updateNavEta();
}

function updateNavInstruction() {
    if (currentStepIndex >= routeSteps.length) {
        $('nav-distance').textContent = 'Arrived!';
        $('nav-direction').textContent = 'You have reached your destination';
        updateNavIcon('arrive', '');
        return;
    }

    var step = routeSteps[currentStepIndex];
    $('nav-distance').textContent = formatDistance(step.distance);
    $('nav-direction').textContent = step.instruction;
    updateNavIcon(step.maneuver, step.modifier);
}

function updateNavEta() {
    var totalSec = 0;
    for (var i = currentStepIndex; i < routeSteps.length; i++) {
        totalSec += routeSteps[i].duration;
    }

    var now = new Date();
    var eta = new Date(now.getTime() + totalSec * 1000);
    $('nav-eta-time').textContent = 'ETA ' + pad2(eta.getHours()) + ':' + pad2(eta.getMinutes());

    var totalDist = 0;
    for (var j = currentStepIndex; j < routeSteps.length; j++) {
        totalDist += routeSteps[j].distance;
    }
    $('nav-eta-remaining').textContent = formatDuration(totalSec) + ' -- ' + formatDistance(totalDist);
}

function updateNavIcon(maneuver, modifier) {
    var iconEl = $('nav-icon');
    var svg = '';

    if (modifier && modifier.indexOf('left') !== -1) {
        svg = '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">' +
            '<path d="M14 6l-6 6 6 6V6z"/></svg>';
    } else if (modifier && modifier.indexOf('right') !== -1) {
        svg = '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">' +
            '<path d="M10 6l6 6-6 6V6z"/></svg>';
    } else if (maneuver === 'arrive') {
        svg = '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">' +
            '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z' +
            'm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
    } else if (maneuver === 'roundabout' || maneuver === 'rotary') {
        svg = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2">' +
            '<circle cx="12" cy="12" r="4"/><path d="M12 2v6M12 16v6"/></svg>';
    } else {
        // Straight / default
        svg = '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">' +
            '<path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>';
    }

    iconEl.innerHTML = svg;
}

function stopNavigation() {
    if (navWatchId !== null) {
        navigator.geolocation.clearWatch(navWatchId);
        navWatchId = null;
    }

    routeSteps = [];
    currentStepIndex = 0;
    routeTotalDuration = 0;
    routeTotalDistance = 0;

    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }

    if (destMarker) {
        map.removeLayer(destMarker);
        destMarker = null;
    }

    if (originMarker) {
        map.removeLayer(originMarker);
        originMarker = null;
    }
    customOrigin = null;

    $('from-input').value = '';
    $('clear-from').style.display = 'none';
    $('nav-panel').style.display = 'none';
    $('route-panel').style.display = 'none';
    $('search-bar').style.display = 'flex';
    $('my-location-btn').style.display = 'flex';

    centerOnUser();
}

// ══════════════════════════════════════════════════════════════
//  Map preference toggles
// ══════════════════════════════════════════════════════════════

function toggleSatelliteView() {
    prefs.satelliteView = !prefs.satelliteView;
    if (prefs.satelliteView) {
        map.removeLayer(tileLayer);
        satelliteLayer.addTo(map);
    } else {
        map.removeLayer(satelliteLayer);
        tileLayer.addTo(map);
    }
    savePrefs();
}

// ══════════════════════════════════════════════════════════════
//  Utilities
// ══════════════════════════════════════════════════════════════

function haversineDistance(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}
