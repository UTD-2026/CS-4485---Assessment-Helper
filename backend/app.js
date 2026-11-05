import express from "express";
import cors from "cors";
import professorRoutes from "./routes/professorRoutes.js";
import cycleRoutes from "./routes/cycleRoutes.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/professors", professorRoutes);
app.use("/api/cycles", cycleRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
