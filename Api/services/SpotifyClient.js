const axios = require("axios");
const querystring = require("querystring");

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;

/**
 * Rafraîchit le token d'accès si nécessaire
 */
async function refreshAccessToken(session) {
    if (!session.refresh_token) {
        console.error("⚠️ Aucun refresh token disponible");
        return false;
    }
    if (Date.now() < session.token_expires_at - 60000) return true;

    try {
        console.log("🔄 Rafraîchissement du token...");
        const response = await axios.post(
            "https://accounts.spotify.com/api/token",
            querystring.stringify({
                grant_type: "refresh_token",
                refresh_token: session.refresh_token,
                client_id,
                client_secret,
            }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        session.access_token = response.data.access_token;
        if (response.data.refresh_token) {
            session.refresh_token = response.data.refresh_token;
        }
        session.token_expires_at = Date.now() + response.data.expires_in * 1000;
        console.log("✅ Nouveau token Spotify obtenu");
        return true;
    } catch (error) {
        console.error("❌ Erreur refresh token:", error.response?.data || error.message);
        return false;
    }
}

async function getAccessToken(code) {
    const response = await axios.post(
        "https://accounts.spotify.com/api/token",
        querystring.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri,
            client_id,
            client_secret,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return response.data;
}

async function playTracks(uris, token) {
    const response = await axios({
        method: "PUT",
        url: "https://api.spotify.com/v1/me/player/play",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: { uris },
    });
    return response.status;
}

async function getPlayerState(token) {
    const response = await axios.get(
        "https://api.spotify.com/v1/me/player/currently-playing",
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.status === 204) return {};
    return response.data;
}

async function controlPlayer(action, token) {
    const actions = { play: "PUT", pause: "PUT", next: "POST", previous: "POST" };
    if (!actions[action]) throw new Error("Action inconnue");

    const response = await axios({
        method: actions[action],
        url: `https://api.spotify.com/v1/me/player/${action}`,
        headers: { Authorization: `Bearer ${token}` },
    });
    return response.status;
}

async function searchTrack(query, token) {
    try {
        const response = await axios.get("https://api.spotify.com/v1/search", {
            headers: { Authorization: `Bearer ${token}` },
            params: { q: query, type: "track", limit: 1 },
        });
        return response.data.tracks.items[0] || null;
    } catch (error) {
        console.error(`Erreur recherche "${query}":`, error.message);
        return null;
    }
}

async function createPlaylist(userId, name, uris, token) {
    const createResponse = await axios.post(
        `https://api.spotify.com/v1/users/${userId}/playlists`,
        { name: name, description: "Générée automatiquement", public: false },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    const playlistId = createResponse.data.id;
    const playlistUrl = createResponse.data.external_urls.spotify;

    if (uris.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < uris.length; i += chunkSize) {
            const chunk = uris.slice(i, i + chunkSize);
            await axios.post(
                `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
                { uris: chunk },
                { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
            );
        }
    }
    return { id: playlistId, url: playlistUrl };
}

async function getUserProfile(token) {
    const response = await axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
}

module.exports = {
    refreshAccessToken,
    getAccessToken,
    playTracks,
    getPlayerState,
    controlPlayer,
    searchTrack,
    createPlaylist,
    getUserProfile,
    client_id,
    redirect_uri
};
