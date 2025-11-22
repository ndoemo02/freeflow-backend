import { normalizeTxt } from "./intentRouterGlue.js";

export function fallbackIntent(text, intent, confidence, session = null) {
  const normalized = normalizeTxt(text || '');
  if (confidence != null && confidence < 0.4) {
    return 'none';
  }

  if (intent && intent !== 'none') return intent;

  if (/(restaurac|zje|jedzen|obiad|kolacj|sniadan)/i.test(normalized)) {
    return 'find_nearby';
  }

  if (session?.expectedContext === 'confirm_order' && /(^|\s)nie(\s|$)/i.test(normalized)) {
    return 'cancel_order';
  }

  return intent;
}
