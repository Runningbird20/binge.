const app = require('./app');
const PORT = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 5001;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
