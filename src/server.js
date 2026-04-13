require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { handleProxyRequest } = require('./proxy');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares de segurança e utilidade
app.use(morgan('combined'));
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false, // Desabilitado para permitir recursos externos
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());

// Servir o frontend estático
app.use(express.static(path.join(__dirname, '../public')));

// =============================================
// ROTA PRINCIPAL DO PROXY
// Tudo que começa com /proxy/* é interceptado
// =============================================
app.get('/proxy', handleProxyRequest);

// Health check para o Render
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`🚀 Proxy server rodando na porta ${PORT}`);
});