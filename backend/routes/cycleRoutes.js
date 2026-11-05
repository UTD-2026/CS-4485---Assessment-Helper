import { Router } from "express";
import { getCurrentCycle } from "../controllers/cycleController.js";

const router = Router();
router.get("/current", getCurrentCycle);
export default router;
