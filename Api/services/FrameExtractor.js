const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Calcule les paramètres d'extraction (Intervalle, Max Frames)
 */
function calculateExtractionParams(duration) {
    let frameInterval, maxFrames;

    if (duration > 3600) { // > 1h
        frameInterval = 120;
        maxFrames = 100;
    } else if (duration > 600) { // > 10min
        frameInterval = 30;
        maxFrames = 50;
    } else {
        frameInterval = 10;
        maxFrames = 30;
    }

    const calculatedFrames = Math.min(Math.ceil(duration / frameInterval), maxFrames);
    return {
        frameInterval,
        maxFrames,
        calculatedFrames: Math.max(calculatedFrames, 1)
    };
}

/**
 * Calcule les coordonnées de crop adaptées à la résolution réelle
 */
function calculateCropCoordinates(cropConfig, videoWidth, videoHeight) {
    const scaleX = videoWidth / 1920;
    const scaleY = videoHeight / 1080;

    return {
        x: Math.round((cropConfig.x || 0) * scaleX),
        y: Math.round((cropConfig.y || 0) * scaleY),
        w: Math.max(Math.round((cropConfig.w || 300) * scaleX), 10), // Min width 10
        h: Math.max(Math.round((cropConfig.h || 100) * scaleY), 10)  // Min height 10
    };
}

/**
 * Exécute le crop sur une image existante avec prétraitement OCR
 */
async function cropFrame(framePath, cropCoords) {
    const tempDir = path.dirname(framePath);
    const fileName = path.basename(framePath);
    const croppedFramePath = path.join(tempDir, `cropped-${fileName}`);

    if (!fs.existsSync(framePath)) return null;

    return new Promise((resolve) => {
        // Filtres d'amélioration pour l'OCR :
        // 1. crop : Découpe la zone
        // 2. scale : Agrandit x4 pour lisser les pixels (encore plus précis)
        // 3. format=gray : Passe en niveaux de gris
        // 4. negate : Inverse les couleurs (Texte blanc sur fond noir -> Texte noir sur fond blanc, mieux pour Tesseract)
        // 5. unsharp : Augmente la netteté
        // 6. eq : Contraste élevé pour binariser
        const filters = [
            `crop=${cropCoords.w}:${cropCoords.h}:${cropCoords.x}:${cropCoords.y}`,
            `scale=iw*4:ih*4:flags=lanczos`,
            // `format=gray`,
            // `eq=contrast=1.5:brightness=0.05`,
            `unsharp=5:5:1.5:5:5:0.0`,
            // `histeq`
        ].join(',');

        ffmpeg(framePath)
            .complexFilter(filters)
            .outputOptions('-vframes 1') // S'assurer qu'on ne sort qu'une frame
            .on("end", () => resolve(croppedFramePath))
            .on("error", (err) => {
                console.error("Erreur crop/filter:", err.message);
                resolve(null);
            })
            .save(croppedFramePath);
    });
}

module.exports = {
    calculateExtractionParams,
    calculateCropCoordinates,
    cropFrame,
    ffmpegPath
};
