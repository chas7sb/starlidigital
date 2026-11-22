import type { ExtractedLeadData, HostedAgentMessage } from './types.js';

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/;

export function extractLeadFromMessages(
  messages: HostedAgentMessage[],
  existingLead?: Partial<ExtractedLeadData> | null
): ExtractedLeadData | null {
  // Only look at user/visitor messages to prevent hallucination from assistant examples!
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length === 0) return null;

  const combinedUserText = userMessages.map(m => m.content).join('\n');
  const lastUserText = userMessages[userMessages.length - 1]?.content || '';

  const emailMatch = combinedUserText.match(EMAIL_REGEX);
  const email = emailMatch ? emailMatch[0].toLowerCase() : existingLead?.email;

  // Phone match: ensure at least 8 digits to avoid matching short numbers or dates
  let phone = existingLead?.phone;
  const phoneCandidates = combinedUserText.match(new RegExp(PHONE_REGEX, 'g'));
  if (phoneCandidates) {
    for (const cand of phoneCandidates) {
      const digitsOnly = cand.replace(/\D/g, '');
      if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
        phone = cand.trim();
        break;
      }
    }
  }

  // Name extraction patterns (RO & EN)
  let name = existingLead?.name;
  if (!name) {
    const namePatterns = [
      /(?:mă\s+numesc|numele\s+meu\s+este|ma\s+numesc)\s+([A-ZĂÎÂȘȚa-zăîâșț]+(?:\s+[A-ZĂÎÂȘȚa-zăîâșț]+)?)/i,
      /(?:my\s+name\s+is|i\s+am|i'm)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
      /(?:sunt)\s+([A-ZĂÎÂȘȚ][a-zăîâșț]+(?:\s+[A-ZĂÎÂȘȚ][a-zăîâșț]+)?)/i
    ];
    for (const pattern of namePatterns) {
      const match = combinedUserText.match(pattern);
      if (match && match[1]) {
        name = match[1].trim();
        break;
      }
    }
  }

  // Budget detection
  let budget = existingLead?.budget;
  if (!budget) {
    const budgetMatch = combinedUserText.match(/(?:buget(?:ul)?(?:\s+este)?|budget(?:\s+is)?)\s*:?\s*(\d+[\d\s.,]*(?:€|\$|eur|ron|lei|usd)?)/i)
      || combinedUserText.match(/(\d+[\d\s.,]*(?:€|\$|eur|ron|lei|usd))/i);
    if (budgetMatch && budgetMatch[1]) {
      budget = budgetMatch[1].trim();
    }
  }

  // Timeframe / Urgency detection
  let timeframe = existingLead?.timeframe;
  if (!timeframe) {
    const tfMatch = combinedUserText.match(/(urgent|cât mai repede|asap|săptămâna asta|luna asta|this week|this month|imediat)/i);
    if (tfMatch) {
      timeframe = tfMatch[1].trim();
    }
  }

  // Intent / Service summary
  let requestedService = existingLead?.requestedService;
  if (!requestedService) {
    const serviceMatch = combinedUserText.match(/(?:doresc|vreau|interesat de|caut|i want|interested in|looking for)\s+([^.,\n]{3,60})/i);
    if (serviceMatch && serviceMatch[1]) {
      requestedService = serviceMatch[1].trim();
    }
  }

  // Intent classification
  let intent = existingLead?.intent || 'GENERAL_INQUIRY';
  if (/preț|cat costa|ofertă|pricing|quote|proposal|cost/i.test(combinedUserText)) {
    intent = 'PRICING_QUOTE';
  } else if (/programare|rezervare|booking|appointment|schedule/i.test(combinedUserText)) {
    intent = 'BOOKING_REQUEST';
  } else if (/suport|ajutor|problemă|help|issue|bug/i.test(combinedUserText)) {
    intent = 'SUPPORT_ISSUE';
  } else if (email || phone) {
    intent = 'QUALIFIED_INTEREST';
  }

  // If no contact info (email or phone) was found, we do NOT register a captured lead yet
  if (!email && !phone) {
    return null;
  }

  // Calculate score (0-100)
  let score = 20; // Base score for engaging
  if (email) score += 30;
  if (phone) score += 25;
  if (name) score += 10;
  if (requestedService) score += 10;
  if (budget || timeframe) score += 5;
  if (score > 100) score = 100;

  const summary = `Lead identificat: ${name || 'Vizitator'} interesat de ${requestedService || 'servicii'}. Contact: ${email || phone || 'nespecificat'}.`;

  return {
    name,
    email,
    phone,
    requestedService,
    budget,
    timeframe,
    intent,
    summary,
    score
  };
}
