const mongoose = require('mongoose');

// Keeping item schema simple so it works for PO, GRN, and Invoice
const itemSchema = new mongoose.Schema({
  itemCode:         { type: String, default: '' },
  description:      { type: String, default: '' },
  quantity:         { type: Number, default: 0 },  // Used by PO & Invoice
  receivedQuantity: { type: Number, default: 0 },  // Used by GRN
  unitPrice:        { type: Number, default: 0 }
}, { _id: false });

const documentSchema = new mongoose.Schema({
  documentType: {
    type: String,
    enum: ['po', 'grn', 'invoice'],
    required: true
  },
  poNumber: {
    type: String,
    required: true,
    index: true 
  },
  fileName: String,
  parsedData: {
    poNumber:      String,
    poDate:        String,
    vendorName:    String,
    grnNumber:     String,
    grnDate:       String,
    invoiceNumber: String,
    invoiceDate:   String,
    items: [itemSchema]
  },
  // This helps track if Gemini actually understood the document
  parseStatus: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },
  parseError: String
}, { timestamps: true });

module.exports = mongoose.model('Document', documentSchema);