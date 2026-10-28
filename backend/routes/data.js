const express = require("express");
const {
  Professor,
  CourseSection,
  EvaluationCycle,
  Observation,
  ObserverMatch,
  Survey,
} = require("../models");

const router = express.Router();

function addReadRoute(path, model, options = {}) {
  router.get(path, async (request, response, next) => {
    try {
      let query = model.find({});

      if (options.exclude) {
        query = query.select(options.exclude);
      }

      const documents = await query.lean().exec();
      response.json({ data: documents });
    } catch (error) {
      next(error);
    }
  });
}

addReadRoute("/professors", Professor, { exclude: "-password_hash" });
addReadRoute("/course-sections", CourseSection);
addReadRoute("/evaluation-cycles", EvaluationCycle);
addReadRoute("/observations", Observation);
addReadRoute("/observer-matches", ObserverMatch);
addReadRoute("/surveys", Survey);

module.exports = router;
