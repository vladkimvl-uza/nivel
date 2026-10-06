#!/bin/bash
# deliverables from masters: desktop 1920/1280, phone 720x1280; posters per step. CRF via env (default 27).
set -e
cd "$(dirname "$0")"
OUT=${OUT:-out}; CRF=${CRF:-27}; mkdir -p $OUT/posters
X="-c:v libx264 -profile:v high -preset slow -bf 0 -g 6 -keyint_min 6 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart -an"
for c in orig brand; do
  ffmpeg -v error -y -i master-$c.mp4 $X -crf $CRF $OUT/nivel-night-$c-1920.mp4
  ffmpeg -v error -y -i master-$c.mp4 -vf scale=1280:720:flags=lanczos $X -crf $CRF $OUT/nivel-night-$c-1280.mp4
  ffmpeg -v error -y -i phone-$c.mp4 $X -crf $CRF $OUT/nivel-night-$c-m.mp4
  i=1
  for t in 0 5.6 9.2 13.96; do
    ffmpeg -v error -y -ss $t -i master-$c.mp4 -frames:v 1 -c:v libwebp -quality 74 $OUT/posters/step0$i-$c-1920.webp
    ffmpeg -v error -y -ss $t -i master-$c.mp4 -frames:v 1 -vf scale=1280:720:flags=lanczos -c:v libwebp -quality 74 $OUT/posters/step0$i-$c-1280.webp
    ffmpeg -v error -y -ss $t -i phone-$c.mp4 -frames:v 1 -c:v libwebp -quality 74 $OUT/posters/step0$i-$c-m.webp
    i=$((i+1))
  done
done
ls -la $OUT $OUT/posters
