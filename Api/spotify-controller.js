require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const fs = require("fs");
const { spawn } = require("child_process");

// Nouveaux Services
const SpotifyClient = require("./services/SpotifyClient");
const YouTubeStreamer = require("./services/YouTubeStreamer");
const FrameExtractor = require("./services/FrameExtractor");
const OcrRecognizer = require("./services/OcrRecognizer");

// Configuration
const upload = multer({ dest: path.join(__dirname, "uploads/") });
const app = express();
const PORT = process.env.PORT || 3000;

// Stockage progression
const analysisProgress = {
  isRunning: false,
  processed: 0,
  total: 0,
  titlesCount: 0,
  recentTitles: [],
  status: "En attente",
  currentStep: 0,
  totalSteps: 8,
  stepDescription: "",
  streamProgress: 0,
  ocrProgress: 0
};

function updateProgress(step, description, extra = {}) {
  analysisProgress.currentStep = step;
  analysisProgress.stepDescription = description;
  analysisProgress.status = `[${step}/8] ${description}`;
  Object.assign(analysisProgress, extra);
  console.log(`✓ [${step}/8] ${description}`);
}

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || "super_secret_key_change_me",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false },
}));

// === ROUTES SPOTIFY ===

app.get("/login", (req, res) => {
  const scope = "user-modify-playback-state user-read-playback-state user-read-currently-playing streaming";
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SpotifyClient.client_id}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(SpotifyClient.redirect_uri)}`;
  res.redirect(authUrl);
});

app.get("/callback", async (req, res) => {
  try {
    const data = await SpotifyClient.getAccessToken(req.query.code);
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    req.session.token_expires_at = Date.now() + data.expires_in * 1000;
    req.session.save(() => res.redirect("/"));
  } catch (error) {
    console.error("Erreur Auth:", error.message);
    res.status(500).send("Erreur authentification Spotify");
  }
});

app.use("/api/player", async (req, res, next) => {
  if (!req.session.access_token) return res.status(401).json({ error: "Non authentifié" });
  const refreshed = await SpotifyClient.refreshAccessToken(req.session);
  if (!refreshed) return res.status(401).json({ error: "Session expirée" });
  req.session.save(() => next());
});

app.put("/api/player/play", async (req, res) => {
  try {
    await SpotifyClient.playTracks(req.body.uris, req.session.access_token);
    res.json({ status: "OK" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/player/current", async (req, res) => {
  try {
    const state = await SpotifyClient.getPlayerState(req.session.access_token);
    res.json(state);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/player/:action", async (req, res) => {
  try {
    await SpotifyClient.controlPlayer(req.params.action, req.session.access_token);
    res.json({ status: "OK" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/playlist/create", async (req, res) => {
  if (!req.session.access_token) return res.status(401).json({ error: "Non authentifié" });

  try {
    const user = await SpotifyClient.getUserProfile(req.session.access_token);
    const { titles, playlistName } = req.body;

    const trackUris = [];
    const notFound = [];

    for (const title of titles) {
      const track = await SpotifyClient.searchTrack(title, req.session.access_token);
      if (track) trackUris.push(track.uri);
      else notFound.push(title);
    }

    const playlist = await SpotifyClient.createPlaylist(user.id, playlistName, trackUris, req.session.access_token);
    res.json({
      success: true,
      playlistUrl: playlist.url,
      tracksAdded: trackUris.length,
      notFound
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === ROUTES VIDÉO ===

app.post("/api/video/youtube-info", async (req, res) => {
  try {
    const duration = await YouTubeStreamer.getVideoDuration(req.body.url);
    res.json({ duration });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/video/get-thumbnail", async (req, res) => {
  try {
    const { url, timestamp } = req.body;
    console.log("📨 [DEBUG] Reçu du frontend:", { url, timestamp });

    // DEBUG: Forcer 5 minutes si on reçoit une petite valeur (cache frontend)
    let finalTimestamp = timestamp || "00:05:00";
    if (timestamp === "00:00:05" || timestamp === 5) {
      console.log("⚠️ [DEBUG] Timestamp trop court détecté, on force 5 minutes (300s)");
      finalTimestamp = 300;
    }

    const thumbnailPath = await YouTubeStreamer.extractThumbnail(url, finalTimestamp);

    // Envoyer l'image
    res.sendFile(thumbnailPath, (err) => {
      if (err) {
        console.error("Erreur envoi thumbnail:", err);
        res.status(500).json({ error: "Erreur lors de l'envoi de l'image" });
      }

      // Nettoyer le fichier après envoi
      setTimeout(() => {
        if (fs.existsSync(thumbnailPath)) {
          try { fs.unlinkSync(thumbnailPath); } catch (e) { }
        }
      }, 5000);
    });
  } catch (e) {
    console.error("Erreur extraction thumbnail:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/video/progress", (req, res) => res.json(analysisProgress));

app.post("/api/video/analyze", upload.single("video"), async (req, res) => {
  console.log("\n=== DÉBUT ANALYSE VIDÉO (MODULAIRE) ===");
  const { videoUrl, x, y, w, h } = req.body;
  const tempDir = path.join(__dirname, "uploads", "frames");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1. Source & Métadonnées
    updateProgress(1, "Analyse de la source...");
    let videoDuration, videoWidth, videoHeight, inputSource, isLocal;

    if (req.file) {
      isLocal = true;
      inputSource = req.file.path;
      videoDuration = 600; // Fallback local
      videoWidth = 1920;
      videoHeight = 1080;
    } else {
      isLocal = false;
      inputSource = videoUrl;
      const meta = await YouTubeStreamer.getVideoMetadata(videoUrl);
      videoDuration = meta.duration;
      videoHeight = 1080;
      videoWidth = Math.round(videoHeight * (16 / 9));
    }

    // 2. Config Crop & Extraction
    const cropConfig = { x: parseInt(x), y: parseInt(y), w: parseInt(w), h: parseInt(h) };
    const finalCrop = FrameExtractor.calculateCropCoordinates(cropConfig, videoWidth, videoHeight);
    const { frameInterval, calculatedFrames } = FrameExtractor.calculateExtractionParams(videoDuration);

    updateProgress(2, `Config: ${calculatedFrames} frames, Crop ${finalCrop.w}x${finalCrop.h}`);

    // 3. Pipeline Extraction + OCR
    analysisProgress.isRunning = true;
    analysisProgress.total = calculatedFrames;
    analysisProgress.processed = 0;
    analysisProgress.titlesCount = 0;

    const detectedTitles = new Set();
    const ocrQueue = [];
    let lastScheduledFrame = 0;
    let processedFiles = 0;

    // Fonction Worker OCR (Utilise FrameExtractor pour le crop et OcrRecognizer pour l'OCR)
    const processFrameWorker = async (frameIndex) => {
      const fileName = `frame-${String(frameIndex).padStart(3, '0')}.png`;
      const framePath = path.join(tempDir, fileName);

      await new Promise(r => setTimeout(r, 500));

      // 1. Crop
      const croppedPath = await FrameExtractor.cropFrame(framePath, finalCrop);

      // 2. OCR
      if (croppedPath) {
        const title = await OcrRecognizer.processImage(croppedPath, detectedTitles);
        if (title) {
          detectedTitles.add(title);
          console.log(`🔍 Titre: "${title}"`);
          analysisProgress.titlesCount = detectedTitles.size;
          analysisProgress.recentTitles = Array.from(detectedTitles).slice(-5);
        }
      }

      // Nettoyage frame originale
      if (fs.existsSync(framePath)) try { fs.unlinkSync(framePath); } catch (e) { }

      processedFiles++;
      analysisProgress.processed = processedFiles;
      analysisProgress.ocrProgress = Math.round((processedFiles / calculatedFrames) * 100);

      if (processedFiles % 5 === 0) {
        updateProgress(6, `Analyse: ${processedFiles}/${calculatedFrames} (${analysisProgress.ocrProgress}%)`);
      }
    };

    updateProgress(5, "Démarrage Pipeline Temps Réel...");

    // Lancement Extraction
    await new Promise((resolve, reject) => {
      if (isLocal) {
        const ffmpeg = require("fluent-ffmpeg");
        ffmpeg(inputSource)
          .screenshots({
            count: calculatedFrames,
            folder: tempDir,
            filename: "frame-%03i.png",
            size: "100%"
          })
          .on('end', resolve)
          .on('error', reject);
      } else {
        const ytStream = YouTubeStreamer.createVideoStream(inputSource);
        const ffmpegArgs = [
          '-i', 'pipe:0',
          '-vf', `fps=1/${frameInterval},scale=${videoWidth}:${videoHeight}:force_original_aspect_ratio=decrease,pad=${videoWidth}:${videoHeight}:(ow-iw)/2:(oh-ih)/2`,
          '-frames:v', calculatedFrames.toString(),
          '-q:v', '2',
          path.join(tempDir, 'frame-%03d.png')
        ];

        const ffmpegSpawn = spawn(FrameExtractor.ffmpegPath, ffmpegArgs);

        ytStream.stdout.pipe(ffmpegSpawn.stdin);

        // --- FIX EPIPE ---
        // Ignorer les erreurs EPIPE sur stdin de ffmpeg (arrive quand ffmpeg ferme le pipe avant la fin du stream)
        ffmpegSpawn.stdin.on('error', (err) => {
          if (err.code !== 'EPIPE') {
            console.error("❌ Erreur stdin ffmpeg:", err);
          }
        });

        // Ignorer les erreurs EPIPE sur stdout de yt-dlp
        ytStream.stdout.on('error', (err) => {
          if (err.code !== 'EPIPE') {
            console.error("❌ Erreur stdout yt-dlp:", err);
          }
        });
        // -----------------

        ffmpegSpawn.stderr.on('data', (data) => {
          const msg = data.toString();
          const frameMatch = msg.match(/frame=\s*(\d+)/);
          if (frameMatch) {
            const currentFrame = parseInt(frameMatch[1]);
            if (currentFrame > lastScheduledFrame) {
              for (let i = lastScheduledFrame + 1; i <= currentFrame; i++) {
                if (i <= calculatedFrames) ocrQueue.push(processFrameWorker(i));
              }
              lastScheduledFrame = currentFrame;
            }
          }
        });

        ffmpegSpawn.on('close', (code) => {
          // Tuer le stream YouTube proprement dès que ffmpeg a fini
          ytStream.kill();

          if (code === 0) resolve();
          else reject(new Error("FFmpeg error"));
        });

        ytStream.stderr.on('data', d => {
          const match = d.toString().match(/(\d+\.\d+)%/);
          if (match) analysisProgress.streamProgress = parseFloat(match[1]);
        });
      }
    });

    await Promise.all(ocrQueue);

    updateProgress(8, "Terminé !");
    if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir, { recursive: true });
    if (isLocal && req.file) fs.unlinkSync(req.file.path);

    res.json({ titles: Array.from(detectedTitles) });

  } catch (error) {
    console.error("Erreur Analyse:", error);
    analysisProgress.status = "Erreur: " + error.message;
    analysisProgress.isRunning = false;
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`✨ Code modulaire chargé (SpotifyClient, YouTubeStreamer, FrameExtractor, OcrRecognizer).`);
});