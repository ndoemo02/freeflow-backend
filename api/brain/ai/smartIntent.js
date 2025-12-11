
import { detectIntent } from "../intents/intentRouterGlue.js";
import { logIssue } from "../utils/intentLogger.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Smart Intent Layer - Intelligent Dispatcher
 * 1. Tries Classic NLU (RegEx/Keywords)
 * 2. If ambiguous, calls LLM (GPT-4o-mini)
 * 3. Returns structured intent with slots
 */
export async function smartResolveIntent({ text, session, restaurants, previousIntent }) {
    // Guard empty input
    if (!text || !text.trim()) {
        return { intent: "unknown", confidence: 0, reason: "empty_input" };
    }

    const startTotal = Date.now();
    const sessionId = session?.sessionId || 'default';

    // 1. Classic NLU
    let classicResult = { intent: 'unknown', confidence: 0, slots: {} };
    try {
        const det = await detectIntent(text, sessionId);
        classicResult = {
            ...det, // Pass through everything (restaurant, parsedOrder, etc.)
            intent: det.intent || 'unknown',
            confidence: det.confidence || 0,
            slots: det.entities || {},
            source: 'classic'
        };
    } catch (e) {
        console.warn('⚠️ Classic NLU failed, falling back:', e.message);
        // Fallback to minimal known state if NLU crashes
        return { intent: 'unknown', confidence: 0, source: 'classic_error' };
    }

    // 1a. High confidence classic short-circuit
    const USE_LLM = process.env.USE_LLM_INTENT === 'true';
    const CLASSIC_THRESHOLD = 0.85;

    if (!USE_LLM) {
        return classicResult;
    }

    // Skip LLM if classic is super confident (and not simple fallback)
    if (
        classicResult.confidence >= CLASSIC_THRESHOLD &&
        classicResult.intent !== 'none' &&
        classicResult.intent !== 'unknown' &&
        classicResult.intent !== 'fallback'
    ) {
        logIntentResolution(text, classicResult, null, 'classic');
        return classicResult;
    }

    // 2. LLM Resolution
    let llmResult = null;
    try {
        const contextData = {
            lastIntent: previousIntent || 'none',
            lastRestaurant: session?.lastRestaurant?.name || null,
            city: session?.last_location || null,
            visibleRestaurants: (restaurants || []).map(r => r.name).slice(0, 5)
        };

        const systemPrompt = `You are the FreeFlow Intent Master.
Analyze user text and return JSON:
{
  "intent": "create_order | show_menu | find_nearby | change_restaurant | confirm_order | cancel_order | smalltalk | unknown",
  "confidence": 0.0-1.0,
  "slots": {
    "restaurantName": "string or null",
    "city": "string or null",
    "items": [{"name": "string", "quantity": number, "extras": []}]
  },
  "reason": "short logic summary"
}
Rules:
- If user wants food/drink -> create_order (extract items)
- If user asks for location/places -> find_nearby
- If user changes preference ('wolałbym pizza', 'jednak kebab', 'wolę burgera') -> find_nearby (with cuisine in slots)
- If user picks a place -> show_menu or confirm selection
context: ${JSON.stringify(contextData)}`;

        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `User: "${text}"` }
                ],
                temperature: 0.0,
                response_format: { type: "json_object" }
            })
        });

        if (response.ok) {
            const json = await response.json();
            const content = json.choices?.[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                llmResult = {
                    intent: parsed.intent || 'unknown',
                    confidence: parsed.confidence || 0,
                    slots: parsed.slots || {},
                    reason: parsed.reason,
                    source: 'llm'
                };
            }
        }
    } catch (err) {
        console.warn('⚠️ SmartIntent LLM failed:', err.message);
    }

    // 3. Hybrid Decision
    let finalResult = classicResult;
    let source = 'classic';

    if (llmResult) {
        // If LLM is very confident, or classic is very weak
        if (llmResult.confidence > (classicResult.confidence + 0.1)) {
            finalResult = llmResult;
            source = 'llm';
        } else if (classicResult.intent === 'unknown' || classicResult.intent === 'none') {
            finalResult = llmResult;
            source = 'llm';
        }
    }

    finalResult.source = source;

    // Log telemetry
    logIntentResolution(text, classicResult, llmResult, source);

    return finalResult;
}

function logIntentResolution(text, classic, llm, chosenSource) {
    // Simple console logger as requested
    console.log(`🧠 [SmartIntent] "${text}" -> ${chosenSource.toUpperCase()}`);
    console.log(`   🔸 Classic: ${classic?.intent} (${classic?.confidence?.toFixed(2)})`);
    if (llm) {
        console.log(`   🔹 LLM:     ${llm?.intent} (${llm?.confidence?.toFixed(2)})`);
        if (llm.slots && Object.keys(llm.slots).length) {
            console.log(`      Slots:   ${JSON.stringify(llm.slots)}`);
        }
    }
}
