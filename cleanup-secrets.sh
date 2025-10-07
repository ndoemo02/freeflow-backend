#!/bin/bash
echo "🧹 Usuwanie sekretów z historii Git (bez naruszania kodu)..."

# 1️⃣ Upewnij się, że masz backup
echo "📦 Tworzę backup repo..."
git clone . ../repo_backup_freeflow_$(date +%Y%m%d_%H%M%S)

# 2️⃣ Instalacja narzędzia do filtrowania historii (jeśli nie masz)
if ! command -v git-filter-repo &> /dev/null
then
    echo "🔧 Instaluję git-filter-repo..."
    pip install git-filter-repo
fi

# 3️⃣ Czyszczenie historii z plików zawierających sekrety
echo "🗑️ Usuwam pliki .env, .env.local, .env.example i inne z historii..."
git filter-repo --path .env --path .env.local --path .env.example --invert-paths

# 4️⃣ Commit czyszczący
echo "✅ Historia repo została oczyszczona z sekretów."

# 5️⃣ Force push (zastępuje starą historię)
read -p "❗ Potwierdź push do GitHub (wpisz 'yes' aby kontynuować): " confirm
if [ "$confirm" = "yes" ]; then
  git push origin --force
  echo "🚀 Nowa czysta historia została wysłana na GitHub!"
else
  echo "⏹️ Anulowano push. Historia lokalnie oczyszczona, ale nie wysłana."
fi
