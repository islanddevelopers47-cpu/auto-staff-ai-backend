import { Router } from "express";
import { listSkillsSummary, getAllSkills, getSkill } from "../../agents/skills-loader.js";
import { authMiddleware } from "../../auth/middleware.js";

export function createSkillsRouter(): Router {
  const router = Router();

  router.get("/skills", authMiddleware, (_req, res) => {
    const skills = listSkillsSummary();
    res.json({ skills, count: skills.length });
  });

  router.get("/skills/:name", authMiddleware, (req, res) => {
    const skill = getSkill(String(req.params.name));
    if (!skill) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(skill);
  });

  return router;
}
