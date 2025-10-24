Stan obecny FreeFlow Brain v1.1 Stable



✅ Naprawione:



&nbsp;Krytyczne timeouty (detectIntent, findRestaurantsByLocation)



&nbsp;Fallback last\_location działa



&nbsp;expectedContext dla select\_restaurant, show\_more\_options, confirm\_order



&nbsp;Wzmocniony boostIntent



&nbsp;Testy Tier 11 (follow-ups) zielone



&nbsp;Nowy /api/brain/reset



&nbsp;Czyste logi + stable model routing



📊 Wynik: 32/44 testy zaliczone (73%)



⚙️ Co jeszcze przed nami:

🔥 FAZA 2 – logika i routing semantyczny



📍 cel: 100% kontekst i flow dialogu bez błędnych przełączeń



Kategoria	Status	Opis

🧠 confirm\_order → change\_restaurant	⚠️ częściowo	"nie" w kontekście potwierdzenia czasem idzie w cancel zamiast change

💬 show\_more\_options w trybie multi-intent	⚠️ częściowo	potrzebne dodatkowe „expectedContext guard” (żeby nie nadpisywał select)

🔢 select\_restaurant (ordinalne “pierwszą / drugą”)	✅ działa	już fixnięte

🧾 Walidacja pustych zapytań (empty text)	🟡 drobiazg	brak return 400 w brainRouter w niektórych edge-case’ach

🕒 Performance threshold (5s → 3.5s)	🟢 optional	poprawić limit timeout guards

🧩 Tests regex mismatch	🟡 kosmetyka	np. “Zamówienie anulowane” vs regex /anulowałam/i

🌐 Test data – Antarktyka	😂 ❌	test z mockiem lokalizacji (można zignorować)

⚡ FAZA 3 – interakcje użytkownika



📍 cel: płynność dialogu i personalizacja Ambera



Element	Status	Opis

🗣️ dialog.js — integracja GPT-4o	🟡 do wdrożenia	wprowadzić warstwę voice personality

🔊 voice-panel — Chirp TTS hard-set	🟢 plan wdrożenia	usuwamy standardowy TTS, integracja z Chirp API

🧰 model-router.js	🟡 do wdrożenia	routing GPT-5 (logic) + GPT-4o (dialog)

💬 Hybrid test („logic + reply”)	🔴 do dodania	symulacja pełnego flow: „Gdzie zjeść → wybierz → potwierdź”

🧩 FAZA 4 – testy integracyjne



📍 cel: pełen cykl zamówienia w 3 krokach



Test	Co sprawdza	Status

🍕 find\_nearby → select\_restaurant → create\_order	flow zamówienia	⚠️ częściowo

✅ create\_order → confirm\_order → finalize	proces zamówienia	⚠️ wymaga dokończenia cancel/confirm branch

🔄 change\_restaurant loop	zmiana knajpy po potwierdzeniu	🟡 logiczna pętla działa, brak test case

🔊 TTS output	synchronizacja z dialogiem	🟡 integracja po stronie frontu

🧱 FAZA 5 – fundament stabilny (deploy-ready)



📍 cel: pełna spójność backendu przed hybrydą voice/dialog



✅ Po tej fazie będziemy mieli:



backend z obsługą 100% kontekstów,



testy semantyczne zaliczone,



gotowy router modeli (4o/5),



stabilne API pod Vercel Edge,



czystą bazę Supabase bez deadlocków.



📌 Propozycja kolejności pracy:



🔧 Dokończyć confirm\_order logic loop (nie/inne → change\_restaurant)



🧩 Dodać model-router.js i dialog.js



🧠 Dodać test integracyjny find\_nearby → select → confirm



🎤 Połączyć z voice-panel (Chirp TTS)



💥 Test pełnego flow (Amber mówi i reaguje)



Chcesz, żebym Ci rozpisał dokładny plan testów logicznych (FAZA 2) w formie gotowych Vitest case’ów (.test.js)?

Taki, żebyśmy mogli po kolei odpalać np. test:confirmOrder, test:showMoreOptions, test:cancelFlow — i mieć pewność, że Amber reaguje logicznie i po ludzku?

