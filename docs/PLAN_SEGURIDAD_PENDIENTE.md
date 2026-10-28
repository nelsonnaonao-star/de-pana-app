# Plan de Seguridad — Pendiente

## Estado
- v1-bajo-riesgo: ✅ Deployado (logs PII eliminados, errores 500 sanitizados, validación UUID, jsonwebtoken eliminado del package.json)
- v2-seguridad-completa: ⏳ En progreso

## BLOQUE 1 — allowNavigation (PENDIENTE, NO aplica)

### Razón:
Los links de chat se abren en WebView (no navegador externo). Restringir `allowNavigation` a 14 dominios rompería links arbitrarios compartidos por usuarios (YouTube, TikTok, Google, etc.).

### Evidencia:
1. MessageBubble.tsx:73-82 — `<a href={href} target="_blank" rel="noopener noreferrer">` abre en WebView
2. MessageBubble.tsx:918-920 — `window.open(url, "_blank")` abre en WebView (openstreetmap.org)
3. AddContact.tsx:300 — `window.open("https://wa.me/...", "_blank")` abre en WebView
4. ContactsList.tsx:56 — `AppLauncher.openUrl()` abre en navegador externo (NO se rompe)

### Acción requerida para poder restringir (NO aplica ahora):
Refactorizar todos los handlers a `AppLauncher.openUrl()` antes de restringir `allowNavigation`.

### Estado: ⏸️ PENDIENTE — Riesgo aceptado hasta que se refactorizen handlers