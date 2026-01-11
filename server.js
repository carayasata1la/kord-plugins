const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use("/", express.static(path.join("/home/container", "public")));

app.listen(PORT, () => {
  console.log("Cloud URL server running on port " + PORT);
});