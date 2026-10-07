#!/bin/bash
# Ролики этапов для сайта из промежуточных int/<k>-{d,m}.mp4 (cx.py, cy.py, ct.py, ci.py). Без звука, +faststart.
# x, y, i — перемотка прокруткой: H.264 High без B-кадров, ключевой кадр каждые 6 кадров (как у первого экрана).
# t — петля, играет сама: ключ раз в 72 кадра, B-кадры — легче.
# Раунд 10: компьютер 1280x720, телефон 540x960 (как у первого экрана; растяжения нет). CRF через окружение.
set -e
OUT=${1:-out}; CRF_D=${CRF_D:-27}; CRF_M=${CRF_M:-28}; mkdir -p "$OUT"
S="-c:v libx264 -profile:v high -preset veryslow -tune film -pix_fmt yuv420p -movflags +faststart -an"
SCRUB="-bf 0 -g 6 -keyint_min 6 -sc_threshold 0"
LOOP="-g 72 -keyint_min 72 -sc_threshold 0"
# y (104 кадра, ключ каждые 6) — на 1 CRF выше: CRF_D+1, CRF_M+1
for k in x y t i; do
  if [ $k = t ]; then G=$LOOP; else G=$SCRUB; fi
  D=$CRF_D; M=$CRF_M; if [ $k = y ]; then D=$((CRF_D+1)); M=$((CRF_M+1)); fi
  ffmpeg -v error -y -i int/$k-d.mp4 $S $G -crf $D "$OUT/$k-d.mp4"
  ffmpeg -v error -y -i int/$k-m.mp4 $S $G -crf $M "$OUT/$k-m.mp4"
done
ls -la "$OUT"
