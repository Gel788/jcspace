# JC SPACE — редизайн сайта

Концепция «Центр управления полётом». Статический сайт: HTML/CSS/JS, Three.js (процедурная 3D-сцена запуска), GSAP ScrollTrigger, Lenis. Все библиотеки и шрифты (Unbounded, JetBrains Mono, Inter, кириллица) лежат в репозитории.

Факты взяты с joycity-space.ru. Технические характеристики — проектные цели, на сайте они так и помечены.

Локальный запуск: `python3 -m http.server` в корне репозитория.

Сборка: `esbuild js/main.js --bundle --minify --format=esm --alias:three=./vendor/three.module.js --outfile=js/app.min.js`
