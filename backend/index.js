import "dotenv/config";
import dns from "node:dns";
import app from "./app.js";
import { connectDB } from "./config/db.js";

// Some networks block Atlas's SRV lookup. Set USE_PUBLIC_DNS=true in .env if you hit that.
if (process.env.USE_PUBLIC_DNS === "true") dns.setServers(["8.8.8.8", "1.1.1.1"]);

const port = process.env.PORT || 5000;

connectDB()
  .then(() => app.listen(port, () => console.log(`API running on http://localhost:${port}`)))
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  });
