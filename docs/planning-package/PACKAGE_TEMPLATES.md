# package.json Şablonları

## Backend package.json

```json
{
  "name": "planning-system-backend",
  "version": "1.0.0",
  "description": "Planning Management System Backend",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest --coverage"
  },
  "keywords": [
    "planning",
    "management",
    "api",
    "express"
  ],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "morgan": "^1.10.0",
    "axios": "^1.4.0",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "nodemon": "^2.0.20",
    "jest": "^29.5.0"
  },
  "engines": {
    "node": ">=14.0.0",
    "npm": ">=6.0.0"
  }
}
```

---

## Frontend package.json

```json
{
  "name": "planning-system-frontend",
  "version": "1.0.0",
  "description": "Planning Management System Frontend",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "axios": "^1.4.0",
    "web-vitals": "^2.1.4"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "eslintConfig": {
    "extends": [
      "react-app"
    ]
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "devDependencies": {
    "tailwindcss": "^3.3.0"
  }
}
```

---

## Installation Instructions

### Backend Setup
```bash
mkdir backend
cd backend

# Package.json dosyasını oluştur ve yukarıdaki içeriği yapıştır
npm install

# .env dosyası oluştur
echo "PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000" > .env

# server.js'i kopyala
# npm run dev
```

### Frontend Setup
```bash
# Create React App kullan VEYA

mkdir frontend
cd frontend

# Package.json dosyasını oluştur ve yukarıdaki içeriği yapıştır
npm install

# .env dosyası oluştur
echo "REACT_APP_API_URL=http://localhost:5000" > .env

# npm start
```
