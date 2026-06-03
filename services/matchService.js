const Document = require('../models/Document');

// --- Fuzzy Matching Helpers ---
// Normalizes "Chicken Momos 24.0 Pieces" -> "chickenmomos240pieces"
function normalizeDesc(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Finds matching item. 
// Tries exact code first (PO vs GRN), then fuzzy description (Invoice vs PO/GRN)
function findItem(target, itemsMap) {
  if (!target) return null;

  // 1. Fast path: Exact itemCode match
  if (target.itemCode && itemsMap[target.itemCode]) {
    return itemsMap[target.itemCode];
  }

  // 2. Fallback: Fuzzy description match (because Invoice uses codes like FG-P-F-0503 
  // while PO uses 11423 for the same item)
  const tNorm = normalizeDesc(target.description);
  for (const item of Object.values(itemsMap)) {
    const iNorm = normalizeDesc(item.description);
    const shorter = tNorm.length <= iNorm.length ? tNorm : iNorm;
    const longer  = tNorm.length <= iNorm.length ? iNorm  : tNorm;
    
    // Check if the first 8 chars of the shorter string match the longer string
    if (shorter.length >= 8 && longer.includes(shorter.substring(0, 8))) {
      return item;
    }
  }
  return null;
}

// --- Main Match Logic ---
// Stateless: We don't save the result, we just calculate it based on DB right now
async function performMatch(poNumber) {
  // Fetch all docs for this PO concurrently
  const [po, grns, invoices] = await Promise.all([
    Document.findOne({ poNumber, documentType: 'po', parseStatus: 'success' }),
    Document.find({ poNumber, documentType: 'grn', parseStatus: 'success' }),
    Document.find({ poNumber, documentType: 'invoice', parseStatus: 'success' })
  ]);

  const linkedDocs = {
    po: po ? { id: po._id, number: po.parsedData.poNumber } : null,
    grns: grns.map(g => ({ id: g._id, number: g.parsedData.grnNumber })),
    invoices: invoices.map(i => ({ id: i._id, number: i.parsedData.invoiceNumber }))
  };

  // --- FIXED: Check ALL missing documents at once ---
  const missingReasons = [];
  
  if (!po) {
    missingReasons.push('po_not_uploaded');
  }
  if (grns.length === 0) {
    missingReasons.push('missing_grn');
  }
  if (invoices.length === 0) {
    missingReasons.push('missing_invoice');
  }

  // If even one is missing, we can't do the 3-way match yet
  if (missingReasons.length > 0) {
    return { 
      poNumber, 
      status: 'insufficient_documents', 
      reasons: missingReasons, 
      linkedDocuments: linkedDocs 
    };
  }
  // ----------------------------------------------------

  const reasons = [];

  // Build PO lookup map
  const poMap = {};
  (po.parsedData.items || []).forEach(item => { poMap[item.itemCode] = item; });

  // Check for duplicate POs
  const poCount = await Document.countDocuments({ poNumber, documentType: 'po', parseStatus: 'success' });
  if (poCount > 1) reasons.push('duplicate_po');

  // Aggregate GRN quantities
  const grnTotals = {}; 
  const grnItemMap = {}; // Keep one instance for description lookup
  grns.forEach(grn => {
    (grn.parsedData.items || []).forEach(item => {
      grnItemMap[item.itemCode] = item;
      grnTotals[item.itemCode] = (grnTotals[item.itemCode] || 0) + item.receivedQuantity;
    });
  });

  // Validate GRN items against PO
  for (const [code, totalRecv] of Object.entries(grnTotals)) {
    const poItem = findItem(grnItemMap[code], poMap);
    if (!poItem) {
      reasons.push('item_missing_in_po');
      continue;
    }
    if (totalRecv > poItem.quantity) {
      reasons.push('grn_qty_exceeds_po_qty');
    }
  }

  // Validate Invoice items
  invoices.forEach(invoice => {
    // Rule: Invoice date must not be after PO date
    if (po.parsedData.poDate && invoice.parsedData.invoiceDate) {
      if (new Date(invoice.parsedData.invoiceDate) > new Date(po.parsedData.poDate)) {
        reasons.push('invoice_date_after_po_date');
      }
    }

    (invoice.parsedData.items || []).forEach(invItem => {
      const poItem = findItem(invItem, poMap);
      if (!poItem) {
        reasons.push('item_missing_in_po');
        return;
      }

      // Rule: Invoice qty <= PO qty
      if (invItem.quantity > poItem.quantity) {
        reasons.push('invoice_qty_exceeds_po_qty');
      }

      // Rule: Invoice qty <= total GRN qty
      const grnItem = findItem(invItem, grnItemMap);
      if (grnItem) {
        const totalGrn = grnTotals[grnItem.itemCode] || 0;
        if (invItem.quantity > totalGrn) {
          reasons.push('invoice_qty_exceeds_grn_qty');
        }
      }
    });
  });

  // --- Determine Final Status ---
  let hasPartialDelivery = false;

  for (const poItem of po.parsedData.items || []) {
    const matchedGrnItem = findItem(poItem, grnItemMap);
    if (matchedGrnItem) {
      const totalGrn = grnTotals[matchedGrnItem.itemCode] || 0;
      if (totalGrn > 0 && totalGrn < poItem.quantity) {
        hasPartialDelivery = true;
      }
    }
  }

  // ADD THIS NEW LINE: Explain WHY it's partially matched
  if (hasPartialDelivery && reasons.length === 0) {
    reasons.push('partial_grn_delivery');
  }

  let status;
  if (reasons.length > 0) {
    // Check if the only reason is a partial delivery (not a strict violation)
    if (reasons.length === 1 && reasons[0] === 'partial_grn_delivery') {
      status = 'partially_matched';
    } else {
      status = 'mismatch'; // Actual rule violations
    }
  } else if (hasPartialDelivery) {
    status = 'partially_matched';
  } else {
    status = 'matched';
  }

  return {
    poNumber,
    status,
    reasons: [...new Set(reasons)], // remove duplicates
    linkedDocuments: linkedDocs
  };
}

module.exports = { performMatch };