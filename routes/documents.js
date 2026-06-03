const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Document = require('../models/Document');
const { parseDocument } = require('../services/geminiService');
const { performMatch } = require('../services/matchService');
const fs = require('fs');

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(pdf|jpg|jpeg|png)$/)) {
      return cb(new Error('Only PDF and image files are allowed!'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const { documentType } = req.body;
    if (!['po', 'grn', 'invoice'].includes(documentType)) {
      return res.status(400).json({ error: 'documentType must be po, grn, or invoice' });
    }

    // 1. Parse with Gemini
    let parsedData;
    try {
      parsedData = await parseDocument(req.file.path, req.file.mimetype, documentType);
    } catch (err) {
      // Guide's trick: Return 422 instead of 500 if the AI fails to read the doc
      return res.status(422).json({ 
        error: 'Failed to parse document with Gemini', 
        details: err.message 
      });
    }

    const poNumber = parsedData.poNumber;
    if (!poNumber) {
      return res.status(422).json({ error: 'Could not extract poNumber from document' });
    }

    // 3. Save to DB
    const doc = await Document.create({
      documentType,
      poNumber,
      fileName: req.file.originalname,
      parsedData,
      parseStatus: 'success'
    });

    // 4. Clean up the file from /uploads (Good practice)
    fs.unlinkSync(req.file.path);

    // 5. Calculate match state on the fly
    const matchResult = await performMatch(poNumber);

    res.status(201).json({
      message: 'Document uploaded and parsed successfully',
      documentId: doc._id,
      poNumber,
      currentMatchStatus: matchResult.status,
      matchResult
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

module.exports = router;