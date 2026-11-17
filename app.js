// Car Nav -- Main app (UI wiring, preferences, recent destinations)
// Depends on: map.js (loaded after this file)

var MAX_RECENT = 20;
var searchDebounce = null;

var prefs = loadPrefs();

// ── DOM helper ──
var $ = function(id) { return document.getElementById(id); };

// ══════════════════════════════════════════════════════════════
//  Preferences (localStorage)
// ══════════════════════════════════════════════════════════════

function loadPrefs() {
    try {
        var saved = localStorage.getItem('cn_prefs');
        if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return {
        avoidTolls: false,
        avoidHighways: false,
        avoidFerries: false,
        satelliteView: false
    };
}

function savePrefs() {
    localStorage.setItem('cn_prefs', JSON.stringify(prefs));
}

// ══════════════════════════════════════════════════════════════
//  Recent destinations (localStorage)
// ══════════════════════════════════════════════════════════════

function loadRecent() {
    try {
        var saved = localStorage.getItem('cn_recent');
        if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return [];
}

function saveRecent(list) {
    localStorage.setItem('cn_recent', JSON.stringify(list));
}

function addRecent(place) {
    var list = loadRecent();
    list = list.filter(function(r) { return r.placeId !== place.placeId; });
    list.unshift(place);
    if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
    saveRecent(list);
}

// ══════════════════════════════════════════════════════════════
//  Favourites (localStorage)
// ══════════════════════════════════════════════════════════════

var MAX_FAVOURITES = 12;

// Default icons for common favourite types
var FAV_ICONS = {
    home: '🏠',
    work: '🏢',
    gym: '🏋️',
    school: '🏫',
    custom: '⭐'
};

function loadFavourites() {
    try {
        var saved = localStorage.getItem('cn_favourites');
        if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return [];
}

function saveFavourites(list) {
    localStorage.setItem('cn_favourites', JSON.stringify(list));
}

function addFavourite(place, label, icon) {
    var list = loadFavourites();
    // Avoid duplicates by lat/lng
    list = list.filter(function(f) {
        return !(Math.abs(f.lat - place.lat) < 0.0001 && Math.abs(f.lng - place.lng) < 0.0001);
    });
    list.push({
        name: place.name,
        address: place.address || '',
        lat: place.lat,
        lng: place.lng,
        label: label || place.name,
        icon: icon || FAV_ICONS.custom
    });
    if (list.length > MAX_FAVOURITES) list = list.slice(-MAX_FAVOURITES);
    saveFavourites(list);
}

function removeFavourite(index) {
    var list = loadFavourites();
    list.splice(index, 1);
    saveFavourites(list);
}

// Track the last destination for the "save to fav" button
var lastRouteDest = null;

// ══════════════════════════════════════════════════════════════
//  Toast notifications
// ══════════════════════════════════════════════════════════════

var toastTimer = null;
function showToast(msg, type) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
        el.className = 'toast';
    }, 3000);
}

// ══════════════════════════════════════════════════════════════
//  Formatting helpers
// ══════════════════════════════════════════════════════════════

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function formatDuration(seconds) {
    seconds = Math.round(seconds);
    if (seconds < 60) return seconds + ' sec';
    var mins = Math.round(seconds / 60);
    if (mins < 60) return mins + ' min';
    var hrs = Math.floor(mins / 60);
    var remainMins = mins % 60;
    if (remainMins === 0) return hrs + ' hr';
    return hrs + ' hr ' + remainMins + ' min';
}

function formatDistance(meters) {
    meters = Math.round(meters);
    if (meters < 1000) return meters + ' m';
    return (meters / 1000).toFixed(1) + ' km';
}

// ══════════════════════════════════════════════════════════════
//  Menu
// ══════════════════════════════════════════════════════════════

function openMenu() {
    $('menu-overlay').style.display = 'block';
    $('side-menu').classList.add('open');
    syncMenuChecks();
}

function closeMenu() {
    $('menu-overlay').style.display = 'none';
    $('side-menu').classList.remove('open');
}

function syncMenuChecks() {
    $('tolls-check').className = 'menu-check' + (prefs.avoidTolls ? ' checked' : '');
    $('highways-check').className = 'menu-check' + (prefs.avoidHighways ? ' checked' : '');
    $('ferries-check').className = 'menu-check' + (prefs.avoidFerries ? ' checked' : '');
    $('satellite-check').className = 'menu-check' + (prefs.satelliteView ? ' checked' : '');
}

// ══════════════════════════════════════════════════════════════
//  Recent destinations modal
// ══════════════════════════════════════════════════════════════

function showRecentModal() {
    var list = loadRecent();
    var container = $('recent-list');

    if (list.length === 0) {
        container.innerHTML = '<p class="empty-state">No recent destinations</p>';
    } else {
        container.innerHTML = '';
        list.forEach(function(item) {
            var el = document.createElement('div');
            el.className = 'recent-item';
            el.innerHTML =
                '<div class="recent-item-icon">' +
                    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<circle cx="12" cy="12" r="10"/>' +
                        '<polyline points="12,6 12,12 16,14"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="recent-item-text">' +
                    '<div class="recent-item-name">' + escapeHtml(item.name) + '</div>' +
                    '<div class="recent-item-address">' + escapeHtml(item.address) + '</div>' +
                '</div>';

            el.addEventListener('click', function() {
                navigateToRecent(item);
            });

            container.appendChild(el);
        });
    }

    $('recent-modal').style.display = 'flex';
}

// ══════════════════════════════════════════════════════════════
//  Suggestions panel (favourites + history on focus)
// ══════════════════════════════════════════════════════════════

var suggestionsVisible = false;

function showSuggestionsPanel() {
    var panel = $('suggestions-panel');
    renderFavGrid();
    renderHistoryList();
    panel.style.display = 'block';
    suggestionsVisible = true;
}

function hideSuggestionsPanel() {
    $('suggestions-panel').style.display = 'none';
    suggestionsVisible = false;
}

function renderFavGrid() {
    var container = $('fav-grid');
    var favs = loadFavourites();
    container.innerHTML = '';

    if (favs.length === 0) {
        // Show placeholder text
        var empty = document.createElement('div');
        empty.className = 'fav-tile add-fav';
        empty.innerHTML = '<div class="fav-tile-icon">＋</div><div class="fav-tile-name">Add fav</div>';
        empty.title = 'Search a place first, then save it as favourite';
        container.appendChild(empty);
        return;
    }

    favs.forEach(function(fav, idx) {
        var tile = document.createElement('div');
        tile.className = 'fav-tile';
        tile.title = fav.name + (fav.address ? '\n' + fav.address : '');
        tile.innerHTML =
            '<div class="fav-tile-icon">' + fav.icon + '</div>' +
            '<div class="fav-tile-name">' + escapeHtml(fav.label) + '</div>';

        tile.addEventListener('click', function() {
            hideSuggestionsPanel();
            navigateToRecent(fav);
        });

        container.appendChild(tile);
    });
}

function renderHistoryList() {
    var container = $('history-list');
    var recent = loadRecent();
    container.innerHTML = '';

    if (recent.length === 0) {
        container.innerHTML = '<div style="padding:0.5rem;color:var(--text-muted);font-size:0.8rem;">No recent searches</div>';
        return;
    }

    // Show up to 8 recent items
    recent.slice(0, 8).forEach(function(item) {
        var el = document.createElement('div');
        el.className = 'history-item';
        el.innerHTML =
            '<div class="history-item-icon">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<circle cx="12" cy="12" r="10"/>' +
                    '<polyline points="12,6 12,12 16,14"/>' +
                '</svg>' +
            '</div>' +
            '<div class="history-item-text">' +
                '<div class="history-item-name">' + escapeHtml(item.name) + '</div>' +
                '<div class="history-item-address">' + escapeHtml(item.address || '') + '</div>' +
            '</div>';

        el.addEventListener('click', function() {
            hideSuggestionsPanel();
            navigateToRecent(item);
        });

        container.appendChild(el);
    });
}

// ══════════════════════════════════════════════════════════════
//  Favourites modal (edit / remove)
// ══════════════════════════════════════════════════════════════

function showFavModal() {
    var list = loadFavourites();
    var container = $('fav-edit-list');

    if (list.length === 0) {
        container.innerHTML = '<p class="empty-state">No favourites yet.<br>Search a destination and tap ★ to save it.</p>';
    } else {
        container.innerHTML = '';
        list.forEach(function(fav, idx) {
            var el = document.createElement('div');
            el.className = 'fav-edit-item';
            el.innerHTML =
                '<div class="fav-edit-item-icon">' + fav.icon + '</div>' +
                '<div class="fav-edit-item-text">' +
                    '<div class="fav-edit-item-name">' + escapeHtml(fav.label) + '</div>' +
                    '<div class="fav-edit-item-address">' + escapeHtml(fav.address || fav.name) + '</div>' +
                '</div>' +
                '<button class="icon-btn" title="Remove">' +
                    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<line x1="18" y1="6" x2="6" y2="18"/>' +
                        '<line x1="6" y1="6" x2="18" y2="18"/>' +
                    '</svg>' +
                '</button>';

            el.querySelector('.icon-btn').addEventListener('click', function() {
                removeFavourite(idx);
                showFavModal(); // re-render
                showToast('Favourite removed');
            });

            container.appendChild(el);
        });
    }

    $('fav-modal').style.display = 'flex';
}

// ══════════════════════════════════════════════════════════════
//  Save to favourites prompt
// ══════════════════════════════════════════════════════════════

/**
 * Update the save-fav button appearance based on whether the current
 * destination is already a favourite (solid star) or not (outline star).
 */
function updateFavButtonState() {
    var btn = $('save-fav-btn');
    if (!btn || !lastRouteDest) return;

    var favs = loadFavourites();
    var isFav = favs.some(function(f) {
        return Math.abs(f.lat - lastRouteDest.lat) < 0.0001 &&
               Math.abs(f.lng - lastRouteDest.lng) < 0.0001;
    });

    var svg = btn.querySelector('svg');
    if (isFav) {
        btn.classList.add('is-favourite');
        btn.title = 'Remove from favourites';
        if (svg) {
            svg.setAttribute('fill', '#f5a623');
            svg.setAttribute('stroke', '#f5a623');
        }
    } else {
        btn.classList.remove('is-favourite');
        btn.title = 'Save to favourites';
        if (svg) {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', '#888');
        }
    }
}

function promptSaveFavourite() {
    if (!lastRouteDest) {
        showToast('No destination to save', 'error');
        return;
    }

    // Check if already a favourite -- if so, remove it (toggle)
    var favs = loadFavourites();
    var favIdx = -1;
    favs.forEach(function(f, i) {
        if (Math.abs(f.lat - lastRouteDest.lat) < 0.0001 &&
            Math.abs(f.lng - lastRouteDest.lng) < 0.0001) {
            favIdx = i;
        }
    });

    if (favIdx >= 0) {
        removeFavourite(favIdx);
        showToast('Removed from favourites');
        updateFavButtonState();
        return;
    }

    // Show the add-favourite dialog
    showFavAddDialog(lastRouteDest);
}

// ══════════════════════════════════════════════════════════════
//  Confirm dialog (replaces browser confirm/alert)
// ══════════════════════════════════════════════════════════════

function showConfirmDialog(title, message, onConfirm, okLabel) {
    var modal = $('confirm-modal');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;

    var okBtn = $('confirm-ok-btn');
    var newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    newOkBtn.id = 'confirm-ok-btn';
    newOkBtn.textContent = okLabel || 'OK';
    newOkBtn.className = 'btn btn-primary';
    newOkBtn.addEventListener('click', function() {
        modal.style.display = 'none';
        if (onConfirm) onConfirm();
    });

    $('confirm-cancel-btn').onclick = function() { modal.style.display = 'none'; };
    $('confirm-close-btn').onclick = function() { modal.style.display = 'none'; };

    modal.style.display = 'flex';
}

// ══════════════════════════════════════════════════════════════
//  Add favourite dialog (replaces browser prompt)
// ══════════════════════════════════════════════════════════════

var selectedFavIcon = '⭐';

function showFavAddDialog(place) {
    var modal = $('fav-add-modal');
    var labelInput = $('fav-label-input');
    labelInput.value = place.name || '';
    selectedFavIcon = '⭐';

    // Reset icon selection
    var iconBtns = document.querySelectorAll('.fav-icon-option');
    iconBtns.forEach(function(btn) {
        btn.classList.remove('selected');
        if (btn.getAttribute('data-icon') === '⭐') {
            btn.classList.add('selected');
        }
    });

    modal.style.display = 'flex';
    labelInput.focus();
    labelInput.select();
}

function initFavAddDialog() {
    // Icon picker
    var iconBtns = document.querySelectorAll('.fav-icon-option');
    iconBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            iconBtns.forEach(function(b) { b.classList.remove('selected'); });
            btn.classList.add('selected');
            selectedFavIcon = btn.getAttribute('data-icon');
        });
    });

    // Save button
    $('fav-add-save-btn').addEventListener('click', function() {
        var label = $('fav-label-input').value.trim();
        if (!label && lastRouteDest) label = lastRouteDest.name;
        if (!label) label = 'Favourite';

        addFavourite(lastRouteDest, label, selectedFavIcon);
        showToast('Saved to favourites ★');
        updateFavButtonState();
        $('fav-add-modal').style.display = 'none';
    });

    // Cancel / close
    $('fav-add-cancel-btn').addEventListener('click', function() {
        $('fav-add-modal').style.display = 'none';
    });
    $('fav-add-close-btn').addEventListener('click', function() {
        $('fav-add-modal').style.display = 'none';
    });

    // Enter key to save
    $('fav-label-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            $('fav-add-save-btn').click();
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  Event wiring
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
    // Init map immediately (no API key needed)
    initMap();

    var fromDebounce = null;

    // ── "From" (origin) search ──
    $('from-input').addEventListener('input', function() {
        var val = this.value;
        $('clear-from').style.display = val ? 'flex' : 'none';

        if (val) {
            hideSuggestionsPanel();
        }

        clearTimeout(fromDebounce);
        fromDebounce = setTimeout(function() {
            searchPlaces(val, 'from');
        }, 400);
    });

    $('from-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            clearTimeout(fromDebounce);
            searchPlaces(this.value, 'from');
            hideSuggestionsPanel();
        }
    });

    $('from-input').addEventListener('focus', function() {
        if (!this.value) {
            hideSearchResults();
            showSuggestionsPanel();
        }
    });

    $('clear-from').addEventListener('click', function() {
        clearCustomOrigin();
        hideSearchResults();
    });

    // ── "To" (destination) search ──
    $('search-input').addEventListener('input', function() {
        var val = this.value;
        $('clear-search').style.display = val ? 'flex' : 'none';

        if (val) {
            hideSuggestionsPanel();
        }

        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(function() {
            searchPlaces(val, 'to');
        }, 400);
    });

    $('search-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            clearTimeout(searchDebounce);
            searchPlaces(this.value, 'to');
            hideSuggestionsPanel();
        }
    });

    $('search-input').addEventListener('focus', function() {
        if (!this.value) {
            hideSearchResults();
            showSuggestionsPanel();
        }
    });

    $('clear-search').addEventListener('click', function() {
        $('search-input').value = '';
        $('clear-search').style.display = 'none';
        hideSearchResults();

        if (destMarker) {
            map.removeLayer(destMarker);
            destMarker = null;
        }
        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }
        $('route-panel').style.display = 'none';
    });

    // ── Swap origin ↔ destination ──
    $('swap-btn').addEventListener('click', swapOriginDest);

    // Close search results / suggestions when clicking outside
    document.addEventListener('click', function(e) {
        var results = $('search-results');
        var searchBar = $('search-bar');
        var sugPanel = $('suggestions-panel');
        var isInside = results.contains(e.target) || searchBar.contains(e.target) || sugPanel.contains(e.target);
        if (!isInside) {
            hideSearchResults();
            hideSuggestionsPanel();
        }
    });

    // ── Route panel ──
    $('start-nav-btn').addEventListener('click', startNavigation);
    $('cancel-route-btn').addEventListener('click', function() {
        if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
        if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
        if (originMarker) { map.removeLayer(originMarker); originMarker = null; }
        customOrigin = null;
        routeSteps = [];
        $('route-panel').style.display = 'none';
        $('search-bar').style.display = 'flex';
        $('search-input').value = '';
        $('clear-search').style.display = 'none';
        $('from-input').value = '';
        $('clear-from').style.display = 'none';
    });

    // ── Navigation panel ──
    $('stop-nav-btn').addEventListener('click', stopNavigation);

    // ── My location FAB ──
    $('my-location-btn').addEventListener('click', function() {
        centerOnUser();
        this.classList.add('active');
        var btn = this;
        setTimeout(function() {
            btn.classList.remove('active');
        }, 1000);
    });

    // ── Side menu ──
    $('menu-btn').addEventListener('click', openMenu);
    $('close-menu-btn').addEventListener('click', closeMenu);
    $('menu-overlay').addEventListener('click', closeMenu);

    $('menu-avoid-tolls').addEventListener('click', function() {
        prefs.avoidTolls = !prefs.avoidTolls;
        savePrefs();
        syncMenuChecks();
    });
    $('menu-avoid-highways').addEventListener('click', function() {
        prefs.avoidHighways = !prefs.avoidHighways;
        savePrefs();
        syncMenuChecks();
    });
    $('menu-avoid-ferries').addEventListener('click', function() {
        prefs.avoidFerries = !prefs.avoidFerries;
        savePrefs();
        syncMenuChecks();
    });
    $('menu-satellite').addEventListener('click', function() {
        toggleSatelliteView();
        syncMenuChecks();
        closeMenu();
    });
    $('menu-recent').addEventListener('click', function() {
        closeMenu();
        showRecentModal();
    });
    $('menu-favourites').addEventListener('click', function() {
        closeMenu();
        showFavModal();
    });

    // ── Save to favourites (from route panel) ──
    $('save-fav-btn').addEventListener('click', promptSaveFavourite);

    // ── Recent modal ──
    $('close-recent-btn').addEventListener('click', function() {
        $('recent-modal').style.display = 'none';
    });
    $('clear-recent-btn').addEventListener('click', function() {
        saveRecent([]);
        $('recent-list').innerHTML = '<p class="empty-state">No recent destinations</p>';
        showToast('Recent destinations cleared');
    });

    // ── Favourites modal ──
    $('close-fav-modal-btn').addEventListener('click', function() {
        $('fav-modal').style.display = 'none';
    });

    // ── Google Drive sync ──
    $('menu-sync-backup').addEventListener('click', function() {
        closeMenu();
        syncExport();
    });
    $('menu-sync-restore').addEventListener('click', function() {
        closeMenu();
        syncImport();
    });

    // ── Init favourite add dialog ──
    initFavAddDialog();
});
