const { exec } = require("child_process");
const path = require("path");
const stringSimilarity = require("string-similarity");
const fs = require("fs");

/**
 * Détecte le chemin Python à utiliser (priorité au .venv)
 */
let pythonCommand = null;

function detectPythonCommand() {
    if (pythonCommand) return pythonCommand;

    const { execSync } = require("child_process");

    // Priority 1: Try .venv Python (where docTR is installed)
    const venvPythonWin = path.join(__dirname, "..", "..", ".venv", "Scripts", "python.exe");
    const venvPythonUnix = path.join(__dirname, "..", "..", ".venv", "bin", "python");

    if (fs.existsSync(venvPythonWin)) {
        pythonCommand = `"${venvPythonWin}"`;
        console.log(`✅ Using .venv Python: ${venvPythonWin}`);
        return pythonCommand;
    }

    if (fs.existsSync(venvPythonUnix)) {
        pythonCommand = `"${venvPythonUnix}"`;
        console.log(`✅ Using .venv Python: ${venvPythonUnix}`);
        return pythonCommand;
    }

    // Priority 2: Try 'python' (global installation)
    try {
        execSync("python --version", { stdio: "ignore" });
        pythonCommand = "python";
        console.warn("⚠️ Using global Python (not .venv). docTR may not be installed.");
        return pythonCommand;
    } catch (e) {
        // Priority 3: Try 'python3' (Linux/Mac global)
        try {
            execSync("python3 --version", { stdio: "ignore" });
            pythonCommand = "python3";
            console.warn("⚠️ Using global Python3 (not .venv). docTR may not be installed.");
            return pythonCommand;
        } catch (e2) {
            console.error("❌ Python not found. Please install Python or activate .venv.");
            pythonCommand = "python"; // Fallback
            return pythonCommand;
        }
    }
}

/**
 * Reconnaît le texte dans une image via docTR (Python)
 */
function recognizeText(imagePath) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, "ocr_script.py");
        const pythonCmd = detectPythonCommand();
        const command = `${pythonCmd} "${scriptPath}" "${imagePath}"`;

        // Timeout de 30 secondes pour éviter les blocages
        const timeout = 30000;
        let timedOut = false;

        const process = exec(command, { timeout }, (error, stdout, stderr) => {
            if (timedOut) {
                console.error(`⏱️ Timeout OCR (${timeout}ms) pour: ${imagePath}`);
                return resolve("");
            }

            if (error) {
                // Si c'est un timeout, l'erreur a le code 'ETIMEDOUT'
                if (error.killed) {
                    console.error(`⏱️ Process OCR tué (timeout) pour: ${imagePath}`);
                    return resolve("");
                }

                console.error(`❌ Erreur exécution Python: ${error.message}`);
                // On ne reject pas forcément, on peut renvoyer vide pour ne pas crasher le flux
                return resolve("");
            }

            if (stderr) {
                // docTR peut sortir des warnings/logs sur stderr, on les affiche
                const stderrStr = stderr.toString();
                if (stderrStr.includes("[OCR]")) {
                    console.log(stderrStr.trim());
                }
            }

            // Nettoyer la sortie (enlever les sauts de ligne finaux)
            const text = stdout.replace(/\r?\n/g, " ").trim();
            resolve(text);
        });

        // Marquer comme timeout si le process dépasse la limite
        setTimeout(() => {
            timedOut = true;
            process.kill();
        }, timeout);
    });
}

/**
 * Nettoie le texte brut de l'OCR
 */
function cleanOcrText(text) {
    if (!text) return "";

    // 1. Remplacer les sauts de ligne par des espaces
    let clean = text.replace(/\n/g, " ");

    // 2. Supprimer les caractères spéciaux bruyants (garder lettres, chiffres, tirets, parenthèses)
    // On supprime les séquences de symboles comme "===", "|", "___"
    clean = clean.replace(/[|={}_\[\]]/g, "");

    // 3. Supprimer les espaces multiples
    clean = clean.replace(/\s+/g, " ").trim();

    return clean;
}

/**
 * Vérifie si un titre est valide
 */
function isValidTitle(title) {
    if (!title) return false;
    if (title.length < 4) return false; // Trop court

    // Si le titre contient trop de caractères non-alphanumériques (bruit)
    const alphaNum = title.replace(/[^a-zA-Z0-9]/g, "").length;
    if (alphaNum < title.length * 0.5) return false; // Moins de 50% de lettres/chiffres

    return true;
}

/**
 * Vérifie si un titre est un doublon flou
 */
function isDuplicateTitle(newTitle, existingTitles) {
    if (!isValidTitle(newTitle)) return true; // Considérer comme doublon (rejeté) si invalide

    for (const title of existingTitles) {
        if (stringSimilarity.compareTwoStrings(newTitle.toLowerCase(), title.toLowerCase()) > 0.7) {
            return true;
        }
    }
    return false;
}

/**
 * Processus complet OCR pour une image (avec nettoyage fichier)
 */
async function processImage(imagePath, existingTitles) {
    if (!fs.existsSync(imagePath)) return null;

    const rawText = await recognizeText(imagePath);
    const cleanText = cleanOcrText(rawText);

    // Nettoyage immédiat de l'image croppée
    try { fs.unlinkSync(imagePath); } catch (e) { }

    if (cleanText && !isDuplicateTitle(cleanText, existingTitles)) {
        return cleanText;
    }
    return null;
}

module.exports = {
    recognizeText,
    isDuplicateTitle,
    processImage
};
