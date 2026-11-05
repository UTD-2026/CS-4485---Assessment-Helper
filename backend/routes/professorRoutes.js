import { Router } from "express";
import { listProfessors, listDueProfessors, getProfessor } from "../controllers/professorController.js";

const router = Router();
router.get("/", listProfessors);
router.get("/due", listDueProfessors); // keep above "/:email"
router.get("/:email", getProfessor);
export default router;
