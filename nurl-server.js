const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("KORD NURL server is running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("NURL server listening on port", PORT);
});