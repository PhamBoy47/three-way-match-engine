const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//PROMPTS 
const PROMPTS = {
  po: `You are a document parser. Extract all data from this Purchase Order PDF.
Return ONLY a valid JSON object. No markdown. No explanation.

Required format:
{
  "poNumber": "string",
  "poDate": "YYYY-MM-DD",
  "vendorName": "string",
  "items": [
    { "itemCode": "string", "description": "string", "quantity": number, "unitPrice": number }
  ]
}
Rules:
- poNumber: The unique Purchase Order identifier (might be labeled as PO No, Order No, etc.)
- poDate: The date the PO was issued, in YYYY-MM-DD format.
- vendorName: The company supplying the goods.
- itemCode: The SKU or product identifier.
- quantity: The total quantity ordered for each item.
- Extract ALL items from ALL pages.`,

  grn: `You are a document parser. Extract all data from this Goods Receipt Note (GRN) or Delivery Note PDF.
Return ONLY a valid JSON object. No markdown. No explanation.

Required format:
{
  "grnNumber": "string",
  "poNumber": "string",
  "grnDate": "YYYY-MM-DD",
  "items": [
    { "itemCode": "string", "description": "string", "receivedQuantity": number, "unitPrice": number }
  ]
}
Rules:
- grnNumber: The unique receipt identifier (might be labeled as GRN No, Receipt No, Docket No, etc.)
- poNumber: The reference to the Purchase Order this delivery belongs to.
- grnDate: The date goods were received, in YYYY-MM-DD format.
- itemCode: The SKU or product identifier.
- receivedQuantity: The physical quantity actually received/delivered (ignore "ordered" or "expected" quantities, only the received ones).
- Extract ALL items from ALL pages.`,

  invoice: `You are a document parser. Extract all data from this Tax Invoice or Bill PDF.
Return ONLY a valid JSON object. No markdown. No explanation.

Required format:
{
  "invoiceNumber": "string",
  "poNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "items": [
    { "itemCode": "string", "description": "string", "quantity": number, "unitPrice": number }
  ]
}
Rules:
- invoiceNumber: The unique invoice identifier (might be labeled as Invoice No, Bill No, etc.)
- poNumber: The reference to the Purchase Order (might be labeled as Customer Order No, PO Ref, Order Ref, etc. FORMAT CONTEXT: It usually follows a pattern like "CI4PO" followed by digits. The "PO" are ALWAYS the english letters P and O, never the number 0).
- invoiceDate: The date the invoice was issued, in YYYY-MM-DD format.
- itemCode: The SKU or product identifier.
- quantity: The quantity being billed.
- Extract ALL items from ALL pages.`
};

// PARSING LOGIC - This is the core function that sends the document to Gemini and gets structured data back
async function parseDocument(filePath, mimeType, documentType) {
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
  const base64 = fs.readFileSync(filePath).toString('base64');

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: mimeType || 'application/pdf' } },
    PROMPTS[documentType]
  ]);

  let text = result.response.text().trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini returned unparseable response');
  }
}

module.exports = { parseDocument };