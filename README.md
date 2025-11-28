# 📌 README — Installation du projet

Ce guide explique comment configurer l’environnement du projet :

* Ajout du fichier `.env`
* Création de l’environnement virtuel `.venv`
* Installation des dépendances Python (`requirements.txt`)
* Installation des dépendances Node (`package.json`)

---

## 🚀 1. Cloner le projet

```bash
git clone <URL_DU_REPO>
cd <NOM_DU_PROJET>
```

---

## 📁 2. Ajouter un fichier `.env`

Créer un fichier `.env` à la racine du projet :

```bash
touch .env
```

Y ajouter vos variables d’environnement, par exemple :

```
API_KEY=your_key_here
SECRET_KEY=your_secret_here
DEBUG=True
```

⚠️ Le fichier `.env` **ne doit pas être poussé sur Git**.
Assurez-vous qu’il est bien dans le `.gitignore` :

```
.env
```

---

## 🐍 3. Créer un environnement Python `.venv`

### Sous Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Sous Windows (PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\activate
```

Ajouter `.venv` dans le `.gitignore` :

```
.venv/
```

---

## 📦 4. Installer les dépendances Python

Assurez-vous que l’environnement virtuel est actif, puis installez :

```bash
pip install -r requirements.txt
```

---

## 🌐 5. Installer les dépendances Node (package.json)

Si le projet contient un `package.json`, installez les dépendances :

```bash
npm install
```

ou si vous utilisez Yarn :

```bash
yarn install
```

---

## ▶️ 6. Lancer le projet

### Python

```bash
python main.py
```

### Node (si applicable)

```bash
npm start
```

---

## 🎉 Le projet est maintenant prêt à être utilisé !
