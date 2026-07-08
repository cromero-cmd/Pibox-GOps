#!/usr/bin/env bash
# ═══════════════════════════════════════════
# bump_version.sh — cache-busting para el pipeline TADA → Trump · Pibox
#
# Agrega/actualiza un query param ?v=VERSION al <script type="module"> de
# index.html (no hay import() dinámicos en el proyecto). Cada vez que el
# hash cambia, el navegador ve una URL nueva para js/main.js y descarta
# cualquier copia cacheada, sin necesidad de renombrar archivos.
#
# NOTA: deliberadamente NO se versionan los imports estáticos internos
# entre módulos (import {...} from './parser.js', etc. dentro de js/*.js).
# Node y el navegador tratan una misma ruta con distinto query string como
# un módulo DISTINTO (instancia separada, sin estado compartido) — eso
# rompería el patrón de estado compartido entre módulos (mallaRaw, tadaNorm,
# concResult, etc.) del que depende todo el pipeline, y desincroniza los
# tests (que importan js/*.js con rutas sin versionar). Alcance del script
# limitado a index.html, tal como se especificó.
#
# Uso: ejecutar antes de cada commit que se vaya a publicar.
#   ./bump_version.sh
# ═══════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(date +%Y%m%d%H%M)

tmp="$(mktemp)"
sed -E "s#(src=\"js/main\.js)(\?v=[0-9]+)?\"#\1?v=${VERSION}\"#" index.html > "$tmp"
mv "$tmp" index.html

echo "✓ Versión ${VERSION} aplicada a index.html (js/main.js?v=${VERSION})"
