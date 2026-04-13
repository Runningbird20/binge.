const app = require('./app');

const port = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 5001;

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
