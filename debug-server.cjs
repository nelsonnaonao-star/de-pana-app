const http = require("http");
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      console.log(`[BROWSER LOG] ${data.level}:`, ...data.args);
    } catch {
      console.log(`[BROWSER RAW] ${body}`);
    }
    res.writeHead(200);
    res.end("ok");
  });
});
server.listen(3456, () => console.log("Debug server listening on port 3456"));
