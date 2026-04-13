require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { handleProxyRequest } = require('./proxy');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('combined'));
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Body parsers para suportar POST
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, '../public')));

// Suporta GET e POST
app.get('/proxy', handleProxyRequest);
app.post('/proxy', handleProxyRequest);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`🚀 Proxy server rodando na porta ${PORT}`);
});