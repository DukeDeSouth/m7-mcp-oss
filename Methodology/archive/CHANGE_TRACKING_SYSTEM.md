# 📝 CHANGE TRACKING SYSTEM

## 🎯 Цель
Предотвратить саморазрушительные циклы, когда AI удаляет собственный код, не узнавая его. Система обеспечивает persistent контекст через маркировку и журналирование.

## 🏷️ СИСТЕМА МАРКИРОВКИ

### Формат маркера
```javascript
// @AI-FIX-001 [2024-01-15 14:32 UTC] Fix: Authentication flow
// @AI-FIX-002 [2024-01-15 15:45 UTC] Add: WebSocket reconnection
// @AI-FIX-003 [2024-01-15 16:20 UTC] Refactor: State management
```

### Правила маркировки
1. **КАЖДОЕ** изменение должно иметь уникальный маркер
2. Формат: `@AI-FIX-XXX [TIMESTAMP] Type: Description`
3. Типы: Fix, Add, Remove, Refactor, Update
4. Таймстамп берется из `date -u +"%Y-%m-%d %H:%M UTC"`
5. Маркеры НЕ удаляются даже при рефакторинге

## 📚 ЖУРНАЛ ИЗМЕНЕНИЙ

### Структура файла
```
docs/changes/
├── CHANGE_LOG.md          # Главный журнал
├── daily/
│   └── 2024-01-15.md     # Дневные логи
└── fixes/
    ├── AI-FIX-001.md      # Детали каждого фикса
    ├── AI-FIX-002.md
    └── AI-FIX-003.md
```

### Формат записи в CHANGE_LOG.md
```markdown
## AI-FIX-001 [2024-01-15 14:32 UTC]
**Type:** Fix
**File:** lib/auth/AuthService.ts
**Lines:** 45-67
**Problem:** JWT token validation failing
**Solution:** Added proper async/await handling
**Git Commit:** abc123def
**Status:** COMPLETED
**Related:** AI-FIX-002, AI-FIX-003

---
```

### Формат детального файла (AI-FIX-XXX.md)
```markdown
# AI-FIX-001: Authentication Flow Fix

## Metadata
- **Timestamp:** 2024-01-15 14:32 UTC
- **Session ID:** session-12345
- **Parent Task:** USER_AUTH_BROKEN
- **Git Branch:** fix/auth-flow

## Problem Statement
Users unable to login due to JWT validation error.

## Root Cause Analysis
1. Async function not properly awaited
2. Token expiry not checked before validation
3. Missing error boundary

## Changes Made
```diff
- const token = getToken()
- validateToken(token)
+ const token = await getToken()
+ if (!isTokenExpired(token)) {
+   await validateToken(token)
+ }
```

## Testing
- [x] Unit tests pass
- [x] Manual login tested
- [x] Error cases handled

## Side Effects
- None identified

## Future Considerations
- Consider implementing token refresh mechanism
```

## 🔄 WORKFLOW ИНТЕГРАЦИЯ

### Before ANY change:
```bash
# 1. Get timestamp
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")

# 2. Get next fix number
LAST_FIX=$(grep -o 'AI-FIX-[0-9]\+' docs/changes/CHANGE_LOG.md | tail -1 | grep -o '[0-9]\+')
NEXT_FIX=$((LAST_FIX + 1))
FIX_ID=$(printf "AI-FIX-%03d" $NEXT_FIX)

# 3. Create fix file
echo "# $FIX_ID: [Brief Description]" > docs/changes/fixes/$FIX_ID.md
```

### During change:
```javascript
// @AI-FIX-001 [2024-01-15 14:32 UTC] Fix: Authentication flow
// ORIGINAL: This code was handling auth incorrectly
const result = await performAuth(); // Fixed async handling
```

### After change:
1. Update CHANGE_LOG.md
2. Complete fix details in AI-FIX-XXX.md
3. Commit with message: `fix: [AI-FIX-001] Authentication flow`

## 🚨 CRITICAL RULES

1. **NEVER** remove AI-FIX markers from code
2. **ALWAYS** check CHANGE_LOG.md before claiming something is buggy
3. **MUST** create journal entry BEFORE making changes
4. **FORBIDDEN** to modify code with recent AI-FIX markers without user approval

## 📊 BENEFITS

1. **Persistent Context:** AI can see what was done when
2. **No Self-Destruction:** Can't delete own work unknowingly  
3. **Clear History:** Every change is traceable
4. **Debugging Aid:** Know exactly what was changed and why
5. **Productivity:** Stop redoing the same fixes

## 🔍 CHECKING PROCEDURES

Before claiming code is "buggy":
```bash
# 1. Check if this has an AI-FIX marker
grep -n "@AI-FIX" <filename>

# 2. Check change log
grep -A 5 "<filename>" docs/changes/CHANGE_LOG.md

# 3. Check git blame
git blame <filename> | grep -C 3 <line_number>

# 4. If AI-FIX found → STOP and ask user
```

## 💡 IMPLEMENTATION CHECKLIST

- [ ] Create docs/changes/ directory structure
- [ ] Initialize CHANGE_LOG.md
- [ ] Add to .cursorrules
- [ ] Update methodology to include tracking
- [ ] Create shell script for timestamp generation
- [ ] Test with first real fix

This system will END the destructive cycles and enable productive development. 