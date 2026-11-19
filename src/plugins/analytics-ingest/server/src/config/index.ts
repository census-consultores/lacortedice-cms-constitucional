export default {
  default: {
    maxBatchSize: 50,
    rateLimitPerMinute: 600,
    allowedOrigins: [
      'https://app.lacortedicetributaria.com',
      'https://www.lacortedicetributaria.com',
      'http://localhost:5173',
    ],
  },
  validator() {
    // opcional: validación de config al cargar
  },
};
