require("dotenv").config();
const express = require("express");
const axios = require("axios");
const querystring = require("querystring");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const client_id = process.env.SPOTIFY_CLIENT_ID;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;

let access_token = null;
let refresh_token = null;
let token_expires_at = 0;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// === Étape 1 : Rediriger vers la page d'autorisation Spotify ===
app.get("/login", (req, res) => {
  console.log("➡️ Redirection vers Spotify pour autorisation...");
  const scope = [
    "user-modify-playback-state",
    "user-read-playback-state",
    "user-read-currently-playing",
    "streaming",
  ].join(" ");

  const authUrl =
    "https://accounts.spotify.com/authorize?" +
    querystring.stringify({
      response_type: "code",
      client_id,
      scope,
      redirect_uri,
    });

  res.redirect(authUrl);
});

// === Étape 2 : Callback Spotify (récupération du code) ===
app.get("/callback", async (req, res) => {
  const code = req.query.code || null;
  console.log("🎟️ Callback reçu avec code:", code);

  try {
    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      querystring.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id,
        client_secret,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    access_token = tokenResponse.data.access_token;
    refresh_token = tokenResponse.data.refresh_token;
    token_expires_at = Date.now() + tokenResponse.data.expires_in * 1000;

    console.log("✅ Token d'accès obtenu");
    console.log("access_token:", access_token);

    res.redirect("/");
  } catch (error) {
    console.error(
      "❌ Erreur callback Spotify:",
      error.response?.data || error.message
    );
    res.status(500).send("Erreur lors de l'authentification Spotify");
  }
});

// === Fonction : rafraîchir le token d'accès si expiré ===
async function refreshAccessToken() {
  if (!refresh_token) {
    console.error("⚠️ Aucun refresh token disponible");
    return;
  }
  if (Date.now() < token_expires_at - 60000) return;

  try {
    console.log("🔄 Rafraîchissement du token...");
    const response = await axios.post(
      "https://accounts.spotify.com/api/token",
      querystring.stringify({
        grant_type: "refresh_token",
        refresh_token,
        client_id,
        client_secret,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    access_token = response.data.access_token;
    token_expires_at = Date.now() + response.data.expires_in * 1000;
    console.log("✅ Nouveau token Spotify obtenu");
  } catch (error) {
    console.error(
      "❌ Erreur lors du rafraîchissement du token:",
      error.response?.data || error.message
    );
  }
}

// === Middleware : vérifier et rafraîchir le token ===
app.use("/api/player", async (req, res, next) => {
  if (!access_token) {
    console.warn("🚫 Requête refusée : pas de token Spotify");
    return res.status(401).json({ error: "Utilisateur non authentifié" });
  }
  await refreshAccessToken();
  next();
});

// === Endpoint : Lancer la lecture d'une URI spécifique ===
app.put("/api/player/play", async (req, res) => {
  const { uris } = req.body;
  console.log(`🎵 Tentative de lancement de piste(s) avec URIs: ${uris}`);

  if (!uris || uris.length === 0) {
    return res
      .status(400)
      .json({ error: "URIs de piste requises dans le corps de la requête." });
  }

  try {
    const response = await axios({
      method: "PUT",
      url: "https://api.spotify.com/v1/me/player/play",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      data: {
        uris,
      },
    });

    console.log(`✅ Piste lancée avec succès sur Spotify`);
    res.json({ status: "OK", uris, spotifyResponse: response.status });
  } catch (error) {
    console.error(
      "❌ Erreur lors du lancement de la piste:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// === Endpoint : obtenir les infos du lecteur actuel ===
app.get("/api/player/current", async (req, res) => {
  console.log("📡 Récupération des infos du lecteur Spotify...");
  try {
    const response = await axios.get(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    if (response.status === 204) {
      console.log("ℹ️ Aucun morceau en cours de lecture");
      return res.json({});
    }

    console.log("🎶 Lecture actuelle récupérée");
    res.json(response.data);
  } catch (error) {
    console.error(
      "❌ Erreur récupération player:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Erreur récupération du lecteur" });
  }
});

// === Endpoint : contrôler le player ===
app.post("/api/player/:action", async (req, res) => {
  const { action } = req.params;
  console.log(`🎛️ Tentative d'action Spotify: ${action}`);

  const actions = {
    play: "PUT",
    pause: "PUT",
    next: "POST",
    previous: "POST",
  };

  if (!actions[action]) {
    console.warn("⚠️ Action inconnue:", action);
    return res.status(400).json({ error: "Action inconnue" });
  }

  const url = `https://api.spotify.com/v1/me/player/${action}`;
  console.log("🔗 URL API Spotify:", url);

  try {
    const response = await axios({
      method: actions[action],
      url,
      headers: { Authorization: `Bearer ${access_token}` },
    });

    console.log(`✅ Action ${action} effectuée avec succès`);
    res.json({ status: "OK", action, spotifyResponse: response.status });
  } catch (error) {
    console.error(
      "❌ Erreur commande player:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur Spotify démarré sur http://localhost:${PORT}`);
  console.log("➡️  Connecte-toi via /login pour démarrer la session Spotify");
});
