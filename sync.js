// Car Nav -- Google Drive Sync via SafePlace iframe + postMessage
// Syncs favourites and recent destinations to Google Drive

var SP_ORIGIN = 'https://dat5ngon.github.io';
var SP_FRAME_ID = 'safePlaceFrame';
var SP_APP_NAME = 'car-nav';
var SP_FILENAME = 'car-nav-data.json';
var SP_TIMEOUT = 10000;

// ══════════════════════════════════════════════════════════════
//  SafePlace postMessage API
// ══════════════════════════════════════════════════════════════

function spRequest(action, params) {
    params = params || {};
    return new Promise(function(resolve, reject) {
        var frame = document.getElementById(SP_FRAME_ID);
        if (!frame || !frame.contentWindow) {
            reject(new Error('SafePlace iframe not available'));
            return;
        }
        var id = 'sp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        var timeout = setTimeout(function() {
            window.removeEventListener('message', handler);
            reject(new Error('SafePlace not responding'));
        }, SP_TIMEOUT);

        function handler(event) {
            if (event.origin !== SP_ORIGIN) return;
            var msg = event.data;
            if (!msg || msg.type !== 'safeplace-response' || msg.id !== id) return;
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            if (msg.ok) resolve(msg);
            else reject(new Error(msg.error || 'Unknown error'));
        }

        window.addEventListener('message', handler);
        var payload = { type: 'safeplace-request', id: id, action: action };
        for (var key in params) {
            if (params.hasOwnProperty(key)) payload[key] = params[key];
        }
        frame.contentWindow.postMessage(payload, SP_ORIGIN);
    });
}

function spPing() {
    return spRequest('ping').then(function() {
        return true;
    }).catch(function() {
        return false;
    });
}

// ══════════════════════════════════════════════════════════════
//  Error handling
// ══════════════════════════════════════════════════════════════

function handleSyncError(err) {
    var msg = err.message || '';
    if (msg.indexOf('not authenticated') !== -1 || msg.indexOf('Not authenticated') !== -1) {
        promptSafePlaceSignIn();
    } else if (msg.indexOf('not responding') !== -1) {
        showConfirmDialog('Connection Issue', 'Could not connect to Safe Place.', function() {
            window.open('https://dat5ngon.github.io/safe-place/', '_blank');
        }, 'Open Safe Place');
    } else {
        showToast('Sync failed: ' + (msg || 'unknown error'), 'error');
    }
}

function promptSafePlaceSignIn() {
    showConfirmDialog(
        'Sign in Required',
        'Sign in to Safe Place first, then try syncing again.',
        function() {
            window.open('https://dat5ngon.github.io/safe-place/', '_blank');
            // Reload iframe when user returns so it picks up new auth
            var onFocus = function() {
                window.removeEventListener('focus', onFocus);
                var frame = document.getElementById(SP_FRAME_ID);
                if (frame) frame.src = frame.src;
            };
            window.addEventListener('focus', onFocus);
        },
        'Open Safe Place'
    );
}

// ══════════════════════════════════════════════════════════════
//  Export (backup to Google Drive)
// ══════════════════════════════════════════════════════════════

function syncExport() {
    var favs = loadFavourites();
    var recent = loadRecent();

    if (favs.length === 0 && recent.length === 0) {
        showToast('Nothing to sync', 'error');
        return;
    }

    showToast('Syncing to Google Drive...');

    spPing().then(function(ok) {
        if (!ok) {
            promptSafePlaceSignIn();
            return;
        }

        var data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            favourites: favs,
            recent: recent
        };

        return spRequest('save', {
            app: SP_APP_NAME,
            filename: SP_FILENAME,
            data: data
        }).then(function() {
            showToast('Backed up ' + favs.length + ' favourites, ' + recent.length + ' recent', 'success');
        });
    }).catch(function(err) {
        handleSyncError(err);
    });
}

// ══════════════════════════════════════════════════════════════
//  Import (restore from Google Drive)
// ══════════════════════════════════════════════════════════════

function syncImport() {
    showToast('Loading from Google Drive...');

    spPing().then(function(ok) {
        if (!ok) {
            promptSafePlaceSignIn();
            return;
        }

        return spRequest('load', {
            app: SP_APP_NAME,
            filename: SP_FILENAME
        }).then(function(result) {
            if (!result.data) {
                showToast('No backup found on Google Drive', 'error');
                return;
            }

            var data = result.data;
            var importedFavs = Array.isArray(data.favourites) ? data.favourites : [];
            var importedRecent = Array.isArray(data.recent) ? data.recent : [];

            // Merge favourites: add new ones (by lat/lng), keep existing
            var currentFavs = loadFavourites();
            var addedFavs = 0;
            importedFavs.forEach(function(imp) {
                var exists = currentFavs.some(function(f) {
                    return Math.abs(f.lat - imp.lat) < 0.0001 && Math.abs(f.lng - imp.lng) < 0.0001;
                });
                if (!exists) {
                    currentFavs.push(imp);
                    addedFavs++;
                }
            });
            if (currentFavs.length > MAX_FAVOURITES) {
                currentFavs = currentFavs.slice(-MAX_FAVOURITES);
            }
            saveFavourites(currentFavs);

            // Merge recent: add new ones (by placeId), keep existing order
            var currentRecent = loadRecent();
            var addedRecent = 0;
            importedRecent.forEach(function(imp) {
                var exists = currentRecent.some(function(r) {
                    return r.placeId === imp.placeId ||
                        (Math.abs(r.lat - imp.lat) < 0.0001 && Math.abs(r.lng - imp.lng) < 0.0001);
                });
                if (!exists) {
                    currentRecent.push(imp);
                    addedRecent++;
                }
            });
            if (currentRecent.length > MAX_RECENT) {
                currentRecent = currentRecent.slice(0, MAX_RECENT);
            }
            saveRecent(currentRecent);

            var parts = [];
            if (addedFavs > 0) parts.push(addedFavs + ' new favourites');
            if (addedRecent > 0) parts.push(addedRecent + ' new recent');
            showToast('Imported: ' + (parts.length > 0 ? parts.join(', ') : 'no changes'), 'success');
        });
    }).catch(function(err) {
        handleSyncError(err);
    });
}
