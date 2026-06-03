const express = require('express');
const router = express.Router();
const { performMatch } = require('../services/matchService');


router.get('/:poNumber', async (req, res) => {
  try {
    // Just compute it right now based on what's in the DB
    const matchResult = await performMatch(req.params.poNumber);
    res.json(matchResult);
  } catch (error) {
    console.error('Match error:', error);
    res.status(500).json({ error: 'Failed to calculate match' });
  }
});

module.exports = router;