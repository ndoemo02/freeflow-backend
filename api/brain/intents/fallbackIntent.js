import { normalizeTxt } from "./intentRouterGlue.js";

export function fallbackIntent(text, intent, confidence, session = null) {
  const normalized = normalizeTxt(text || '');
  const ctx = session || {};

  // 1. Jeśli już mamy jakąś sensowną intencję → nie ruszaj
  if (intent && intent !== 'none') {
    return intent;
  }

  // 2. "tak / ok / jasne / pewnie" + zapamiętana restauracja → pokaż jej menu
  //    Przypadek: wcześniej padło pytanie "Chcesz zobaczyć menu restauracji X?"
  if (
    /( ^|\s)(tak|ok|dobrze|zgoda|pewnie|jasne|oczywiscie)(\s|$)/i.test(normalized) &&
    ctx.lastRestaurant
  ) {
    return 'menu_request';
  }

  // 3. Ogólne gadanie o jedzeniu/restauracjach → find_nearby
  if (/(restaurac|zje|jedzen|obiad|kolacj|sniadan)/i.test(normalized)) {
    return 'find_nearby';
  }

  // 4. W trakcie potwierdzania zamówienia "nie" → anuluj
  if (ctx?.expectedContext === 'confirm_order' && /(^|\s)nie(\s|$)/i.test(normalized)) {
    return 'cancel_order';
  }

  // 5. Przy bardzo niskiej pewności i braku innych reguł – zostań przy 'none'
  if (confidence != null && confidence < 0.4 && !intent) {
    return 'none';
  }

  return intent || 'none';
}
