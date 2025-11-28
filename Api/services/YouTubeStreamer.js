const { spawn } = require("child_process");

/**
 * Récupère la durée d'une vidéo YouTube
 */
async function getVideoDuration(url) {
    return new Promise((resolve, reject) => {
        const ytDlp = spawn('yt-dlp', [url, '--print', '%(duration)s', '--no-warnings']);
        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', d => stdout += d.toString());
        ytDlp.stderr.on('data', d => stderr += d.toString());

        ytDlp.on('close', (code) => {
            if (code === 0) {
                const duration = parseInt(stdout.trim());
                if (isNaN(duration)) reject(new Error("Durée invalide"));
                else resolve(duration);
            } else {
                reject(new Error(`yt-dlp failed: ${stderr}`));
            }
        });
    });
}

/**
 * Récupère les métadonnées complètes
 */
async function getVideoMetadata(url) {
    return new Promise((resolve, reject) => {
        const ytDlp = spawn('yt-dlp', ['--skip-download', '-J', '--no-warnings', '--no-playlist', url]);
        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', d => stdout += d.toString());
        ytDlp.stderr.on('data', d => stderr += d.toString());

        ytDlp.on('close', (code) => {
            if (code === 0) {
                try { resolve(JSON.parse(stdout)); }
                catch (e) { reject(new Error("JSON parse error")); }
            } else {
                reject(new Error(`yt-dlp failed: ${stderr}`));
            }
        });
    });
}

/**
 * Crée un stream vidéo 720p
 * @param {string} url - URL YouTube
 * @param {number|null} startTime - (Optionnel) Démarrer à ce timestamp en secondes
 */
function createVideoStream(url, startTime = null) {
    const args = [
        url,
        '--format', 'bestvideo[height<=1080][ext=mp4] / bestvideo[height<=1080]',
        '--output', '-',
        '--no-warnings',
        '--quiet',
        '-N', '12',
        '--force-ipv4'
    ];

    // Si un temps de départ est spécifié, on utilise ffmpeg comme downloader pour seek à la source
    // Cela permet de ne télécharger que la partie nécessaire !
    if (startTime !== null) {
        args.push('--downloader', 'ffmpeg');
        args.push('--downloader-args', `ffmpeg_i:-ss ${startTime}`);
    }

    console.log("🎥 [DEBUG] createVideoStream args:", args.join(" "));

    return spawn('yt-dlp', args);
}

/**
 * Extrait une frame de prévisualisation depuis une URL YouTube
 * RÉUTILISE le même pattern que l'analyse vidéo (createVideoStream + ffmpeg spawn)
 * OPTIMISÉ: Utilise le seek à la source pour ne pas tout télécharger
 */
/**
 * Récupère l'URL directe du flux vidéo (pour ffmpeg)
 */
async function getDirectVideoUrl(url) {
    return new Promise((resolve, reject) => {
        // -g : get url
        // -f : format (best video <= 1080p)
        const args = [
            url,
            '-g',
            '-f', 'bestvideo[height<=1080][ext=mp4]/best[height<=1080]',
            '--no-warnings'
        ];

        const ytDlp = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', d => stdout += d.toString());
        ytDlp.stderr.on('data', d => stderr += d.toString());

        ytDlp.on('close', (code) => {
            if (code === 0) {
                const directUrl = stdout.trim().split('\n')[0]; // Prend la première URL si plusieurs
                if (directUrl) resolve(directUrl);
                else reject(new Error("Aucune URL trouvée"));
            } else {
                reject(new Error(`yt-dlp get-url failed: ${stderr}`));
            }
        });
    });
}

/**
 * Extrait une frame de prévisualisation depuis une URL YouTube
 * RÉUTILISE le même pattern que l'analyse vidéo (createVideoStream + ffmpeg spawn)
 * OPTIMISÉ: Utilise le seek à la source pour ne pas tout télécharger
 */
async function extractThumbnail(url, timestamp = 5) {
    const path = require("path");
    const fs = require("fs");
    const ffmpegPath = require("ffmpeg-static");

    try {
        // Convertir timestamp string → number
        let timestampSeconds = timestamp;
        if (typeof timestamp === 'string') {
            const parts = timestamp.split(':').map(p => parseInt(p));
            if (parts.length === 3) {
                timestampSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length === 2) {
                timestampSeconds = parts[0] * 60 + parts[1];
            } else {
                timestampSeconds = parseInt(timestamp);
            }
        }

        console.log(`⏱️ [DEBUG] Timestamp reçu: "${timestamp}" -> Converti en secondes: ${timestampSeconds}`);
        console.log("🎬 Extraction thumbnail à", timestampSeconds, "secondes");

        // Créer le dossier de destination
        const tempDir = path.join(__dirname, "..", "uploads", "thumbnails");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const thumbnailPath = path.join(tempDir, `preview-${Date.now()}.jpg`);
        console.log("💾 Destination:", thumbnailPath);

        // 1. Récupérer l'URL directe (AWAIT ici, hors de la Promise ffmpeg)
        console.log("🔗 Récupération URL directe...");
        const directUrl = await getDirectVideoUrl(url);
        console.log("✅ URL directe obtenue");

        // 2. Lancer ffmpeg dans une Promise
        return new Promise((resolve, reject) => {
            const ffmpegArgs = [
                '-ss', timestampSeconds.toString(),  // Seek rapide (avant input)
                '-i', directUrl,                     // Input URL directe
                '-vframes', '1',                     // 1 frame
                '-q:v', '2',                         // Qualité
                '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
                '-y',                                // Overwrite
                thumbnailPath
            ];

            console.log("🚀 Lancement ffmpeg (Direct Seek)...");
            const ffmpegSpawn = spawn(ffmpegPath, ffmpegArgs);
            let errorOutput = '';

            ffmpegSpawn.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            ffmpegSpawn.on('close', (code) => {
                console.log(`🔚 ffmpeg terminé (code: ${code})`);

                if (code === 0) {
                    if (fs.existsSync(thumbnailPath)) {
                        const stats = fs.statSync(thumbnailPath);
                        console.log(`✅ Thumbnail créé: ${stats.size} bytes`);
                        resolve(thumbnailPath);
                    } else {
                        reject(new Error("Fichier thumbnail non créé malgré code 0"));
                    }
                } else {
                    console.error("❌ Erreur ffmpeg output:", errorOutput);
                    reject(new Error(`ffmpeg échoué avec code ${code}`));
                }
            });

            ffmpegSpawn.on('error', (err) => {
                console.error("❌ Erreur spawn ffmpeg:", err);
                reject(err);
            });
        });

    } catch (error) {
        console.error("❌ Erreur extractThumbnail:", error);
        throw error;
    }
}

module.exports = {
    getVideoDuration,
    getVideoMetadata,
    createVideoStream,
    extractThumbnail
};
